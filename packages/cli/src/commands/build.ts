/**
 * Build command - compile grammar.js to WASM and bundle server
 */

import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { build as esbuild } from 'esbuild';
import ora from 'ora';
import pc from 'picocolors';
import type { ResolvedLanguageProject, ConfigResult } from '../config.js';
import { getCodegenBackend } from '../backends.js';

/**
 * Map from backend id to the runtime import specifier used in the server entry.
 */
const BACKEND_RUNTIME_IMPORT: Record<string, { specifier: string; className: string }> = {
  'tree-sitter': { specifier: 'treelsp/backend/tree-sitter', className: 'TreeSitterRuntime' },
  'lezer': { specifier: 'treelsp/backend/lezer', className: 'LezerRuntime' },
};

/**
 * Build a single language project: compile parser + bundle server.
 */
export async function buildProject(project: ResolvedLanguageProject) {
  const label = relative(process.cwd(), project.projectDir) || project.projectDir;
  const spinner = ora(`Building ${label}...`).start();

  try {
    // 1. Resolve the backend
    const backend = await getCodegenBackend(project.backend);

    // 2. Compile parser (backend-specific: tree-sitter generates C + WASM, lezer generates JS, etc.)
    spinner.text = `Compiling parser for ${label}...`;
    await backend.compile(project.projectDir, project.outDir, {
      onProgress: (msg) => { spinner.text = `${msg} (${label})`; },
    });

    // 3. Clean up backend-specific build artifacts
    if (backend.cleanupPatterns) {
      const { directories, files, globs } = backend.cleanupPatterns;
      if (directories) {
        for (const dir of directories) {
          const p = resolve(project.projectDir, dir);
          if (existsSync(p)) {
            rmSync(p, { recursive: true, force: true });
          }
        }
      }
      if (files) {
        for (const file of files) {
          const p = resolve(project.projectDir, file);
          if (existsSync(p)) {
            rmSync(p, { force: true });
          }
        }
      }
      if (globs) {
        for (const pattern of globs) {
          // Simple glob: split on '*' and match prefix/suffix
          const parts = pattern.split('*');
          if (parts.length === 2) {
            const [prefix, suffix] = parts;
            for (const f of readdirSync(project.projectDir)) {
              if (f.startsWith(prefix!) && f.endsWith(suffix!)) {
                rmSync(resolve(project.projectDir, f), { force: true });
              }
            }
          }
        }
      }
    }

    // 4. Bundle language server into a self-contained CJS file
    spinner.text = `Bundling language server for ${label}...`;

    const runtimeImport = BACKEND_RUNTIME_IMPORT[project.backend];
    if (!runtimeImport) {
      throw new Error(`No runtime import configured for backend "${project.backend}"`);
    }

    let serverEntry: string;

    if (project.backend === 'lezer') {
      // Lezer: statically import the parser bundle (esbuild inlines it)
      serverEntry = [
        `import { startStdioServer } from 'treelsp/server';`,
        `import { ${runtimeImport.className} } from '${runtimeImport.specifier}';`,
        `import definition from './grammar.ts';`,
        `import { parser } from './generated/parser.bundle.js';`,
        `import parserMeta from './generated/parser-meta.json';`,
        ``,
        `const backend = new ${runtimeImport.className}(parser, parserMeta);`,
        `startStdioServer({ definition, parserPath: '', backend });`,
      ].join('\n');
    } else {
      // Tree-sitter: load grammar.wasm at runtime
      serverEntry = [
        `import { startStdioServer } from 'treelsp/server';`,
        `import { ${runtimeImport.className} } from '${runtimeImport.specifier}';`,
        `import { resolve, dirname } from 'node:path';`,
        `import { fileURLToPath } from 'node:url';`,
        `import definition from './grammar.ts';`,
        ``,
        `const __dirname = dirname(fileURLToPath(import.meta.url));`,
        `const parserPath = resolve(__dirname, 'grammar.wasm');`,
        ``,
        `startStdioServer({ definition, parserPath, backend: new ${runtimeImport.className}() });`,
      ].join('\n');
    }

    // Locate treelsp's node_modules so esbuild can resolve vscode-languageserver.
    const treelspServer = import.meta.resolve('treelsp/server');
    // treelsp/server resolves to .../packages/treelsp/dist/server/index.js
    const treelspPkg = resolve(new URL(treelspServer).pathname, '..', '..', '..');
    const bundlePath = resolve(project.outDir, 'server.bundle.cjs');

    // resolveDir is projectDir so ./grammar.ts finds the user's language definition
    await esbuild({
      stdin: {
        contents: serverEntry,
        resolveDir: project.projectDir,
        loader: 'ts',
      },
      bundle: true,
      format: 'cjs',
      platform: 'node',
      outfile: bundlePath,
      sourcemap: true,
      nodePaths: [resolve(treelspPkg, 'node_modules')],
      logLevel: 'warning',
      logOverride: { 'empty-import-meta': 'silent' },
    });

    // esbuild replaces import.meta with an empty object in CJS mode,
    // so import.meta.url becomes undefined. Patch __dirname usage directly.
    const { readFileSync, writeFileSync } = await import('node:fs');
    let bundleCode = readFileSync(bundlePath, 'utf-8');
    bundleCode = bundleCode.replace(
      /var import_meta\s*=\s*\{\s*\};/,
      'var import_meta = { url: require("url").pathToFileURL(__filename).href };'
    );
    writeFileSync(bundlePath, bundleCode);

    // 5. Copy backend runtime files (e.g., tree-sitter.wasm)
    if (backend.getRuntimeFiles) {
      for (const { src, dest } of backend.getRuntimeFiles(treelspPkg)) {
        const destPath = resolve(project.outDir, dest);
        if (existsSync(src) && !existsSync(destPath)) {
          copyFileSync(src, destPath);
        }
      }
    }

    const outLabel = relative(process.cwd(), project.outDir) || project.outDir;
    spinner.succeed(`Built ${label} -> ${outLabel}/`);

  } catch (error) {
    spinner.fail(`Build failed for ${label}`);

    if (error instanceof Error) {
      // esbuild rejects with an errors array
      const esbuildError = error as Error & { errors?: Array<{ text: string; location?: { file: string; line: number } }> };
      // execSync throws with stderr in the error object
      const execError = error as Error & { stderr?: Buffer };

      if (esbuildError.errors && esbuildError.errors.length > 0) {
        console.error(pc.red('\nServer bundling failed:'));
        for (const err of esbuildError.errors) {
          const loc = err.location
            ? ` (${err.location.file}:${err.location.line})`
            : '';
          console.error(pc.dim(`  ${err.text}${loc}`));
        }
      } else if (execError.stderr) {
        const stderr = execError.stderr.toString();
        console.error(pc.red('\nBackend compilation error:'));
        console.error(pc.dim(stderr));
      } else {
        console.error(pc.red(`\n${error.message}`));
      }
    }

    throw error;
  }
}

/**
 * Top-level build command handler.
 */
export async function build(configResult: ConfigResult) {
  for (const project of configResult.projects) {
    await buildProject(project);
  }
}
