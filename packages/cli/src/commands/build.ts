/**
 * Build command - compile grammar.js to WASM and bundle server
 */

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import ora from 'ora';
import pc from 'picocolors';
import type { ResolvedLanguageProject, ConfigResult } from '../config.js';

// Resolve the tree-sitter binary from the tree-sitter-cli dependency
const treeSitterBin = resolve(
  dirname(fileURLToPath(import.meta.resolve('tree-sitter-cli/cli.js'))),
  'tree-sitter',
);

/**
 * Build a single language project: tree-sitter generate + build --wasm + bundle server.
 */
export async function buildProject(project: ResolvedLanguageProject) {
  const label = relative(process.cwd(), project.projectDir) || project.projectDir;
  const spinner = ora(`Building ${label}...`).start();

  try {
    // 1. Check that grammar.js exists in outDir
    const grammarJsPath = resolve(project.outDir, 'grammar.js');
    if (!existsSync(grammarJsPath)) {
      spinner.fail(`${relative(process.cwd(), grammarJsPath)} not found`);
      console.log(pc.dim('\nRun "treelsp generate" first to create grammar.js'));
      throw new Error('grammar.js not found');
    }

    // 2. Run tree-sitter generate (generates C parser from grammar.js)
    //    tree-sitter runs grammar.js through Node.js, which fails in
    //    "type": "module" packages because grammar.js uses CommonJS.
    //    A temporary package.json in generated/ overrides the parent to CommonJS.
    spinner.text = `Generating C parser for ${label}...`;
    const genPkgJson = resolve(project.outDir, 'package.json');
    const hadPkgJson = existsSync(genPkgJson);

    if (!hadPkgJson) {
      writeFileSync(genPkgJson, '{"type":"commonjs"}\n');
    }

    // Compute path to grammar.js relative to projectDir for tree-sitter
    const relGrammarJs = relative(project.projectDir, grammarJsPath);

    try {
      execSync(`${treeSitterBin} generate ${relGrammarJs}`, {
        stdio: 'pipe',
        cwd: project.projectDir,
      });
    } finally {
      if (!hadPkgJson) {
        rmSync(genPkgJson, { force: true });
      }
    }

    // 3b. Copy external scanner source if present (scanner.c or scanner.cc)
    //     tree-sitter expects it in src/ alongside the generated parser.c.
    //     The user keeps the scanner at the project root; cleanup removes src/.
    for (const scannerFile of ['scanner.c', 'scanner.cc']) {
      const scannerSrc = resolve(project.projectDir, scannerFile);
      const scannerDest = resolve(project.projectDir, 'src', scannerFile);
      if (existsSync(scannerSrc)) {
        copyFileSync(scannerSrc, scannerDest);
      }
    }

    // 4. Run tree-sitter build --wasm (compiles to WebAssembly)
    spinner.text = `Compiling to WASM for ${label}...`;
    execSync(`${treeSitterBin} build --wasm`, {
      stdio: 'pipe',
      cwd: project.projectDir,
    });

    // 5. Move tree-sitter-*.wasm to outDir/grammar.wasm
    //    tree-sitter outputs tree-sitter-{name}.wasm in cwd (projectDir)
    spinner.text = 'Moving WASM output...';
    const wasmFiles = readdirSync(project.projectDir).filter(
      f => f.startsWith('tree-sitter-') && f.endsWith('.wasm')
    );
    if (wasmFiles.length === 0) {
      spinner.fail('tree-sitter build --wasm did not produce a .wasm file');
      throw new Error('No .wasm file produced');
    }
    const sourceWasm = resolve(project.projectDir, wasmFiles[0]!);
    const destWasm = resolve(project.outDir, 'grammar.wasm');
    renameSync(sourceWasm, destWasm);

    // 6. Clean up tree-sitter generate artifacts (C source, bindings, etc.)
    const cleanupDirs = ['src', 'bindings'];
    const cleanupFiles = [
      'binding.gyp', 'Makefile', 'Package.swift', '.editorconfig',
    ];
    for (const dir of cleanupDirs) {
      const p = resolve(project.projectDir, dir);
      if (existsSync(p)) {
        rmSync(p, { recursive: true, force: true });
      }
    }
    for (const file of cleanupFiles) {
      const p = resolve(project.projectDir, file);
      if (existsSync(p)) {
        rmSync(p, { force: true });
      }
    }
    // Remove tree-sitter-{name}.pc files
    for (const f of readdirSync(project.projectDir)) {
      if (f.startsWith('tree-sitter-') && f.endsWith('.pc')) {
        rmSync(resolve(project.projectDir, f), { force: true });
      }
    }

    // 7. Bundle language server into a self-contained CJS file
    //    The entry point is created inline — no generated server.js needed.
    //    It imports treelsp/server and the user's grammar definition, then starts.
    spinner.text = `Bundling language server for ${label}...`;

    const serverEntry = [
      `import { startStdioServer } from 'treelsp/server';`,
      `import { resolve, dirname } from 'node:path';`,
      `import { fileURLToPath } from 'node:url';`,
      `import definition from './grammar.ts';`,
      ``,
      `const __dirname = dirname(fileURLToPath(import.meta.url));`,
      `const wasmPath = resolve(__dirname, 'grammar.wasm');`,
      ``,
      `startStdioServer({ definition, wasmPath });`,
    ].join('\n');

    // Locate treelsp's node_modules so esbuild can resolve vscode-languageserver.
    // import.meta.resolve is synchronous in Node 20+ and returns a file:// URL.
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
    const { readFileSync } = await import('node:fs');
    let bundleCode = readFileSync(bundlePath, 'utf-8');
    bundleCode = bundleCode.replace(
      /var import_meta\s*=\s*\{\s*\};/,
      'var import_meta = { url: require("url").pathToFileURL(__filename).href };'
    );
    writeFileSync(bundlePath, bundleCode);

    // web-tree-sitter needs tree-sitter.wasm alongside the server bundle.
    // When bundled, it looks in the same directory as the JS file.
    const treelspNodeModules = resolve(treelspPkg, 'node_modules');
    const tsWasmSrc = resolve(treelspNodeModules, 'web-tree-sitter', 'tree-sitter.wasm');
    const tsWasmDest = resolve(project.outDir, 'tree-sitter.wasm');
    if (existsSync(tsWasmSrc) && !existsSync(tsWasmDest)) {
      copyFileSync(tsWasmSrc, tsWasmDest);
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
        console.error(pc.red('\nTree-sitter error:'));
        console.error(pc.dim(stderr));

        if (stderr.includes('grammar')) {
          console.log(pc.dim('\nSuggestion: Check your grammar definition for errors'));
        } else if (stderr.includes('emcc') || stderr.includes('compiler')) {
          console.log(pc.dim('\nSuggestion: Ensure Emscripten is installed for WASM compilation'));
          console.log(pc.dim('  See: https://tree-sitter.github.io/tree-sitter/creating-parsers#tool-overview'));
        }
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
