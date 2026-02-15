/**
 * Build command - compile grammar.js to WASM and bundle server
 */

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build as esbuild } from 'esbuild';
import ora from 'ora';
import pc from 'picocolors';

export async function build() {
  const spinner = ora('Checking prerequisites...').start();

  try {
    // 1. Check that generated/grammar.js exists
    const grammarPath = resolve(process.cwd(), 'generated', 'grammar.js');
    if (!existsSync(grammarPath)) {
      spinner.fail('generated/grammar.js not found');
      console.log(pc.dim('\nRun "treelsp generate" first to create grammar.js'));
      process.exit(1);
    }

    // 2. Check tree-sitter CLI is installed
    try {
      execSync('tree-sitter --version', { stdio: 'ignore' });
    } catch {
      spinner.fail('tree-sitter CLI not found');
      console.log(pc.dim('\nInstall tree-sitter CLI:'));
      console.log(pc.dim('  npm install -g tree-sitter-cli'));
      console.log(pc.dim('  or: cargo install tree-sitter-cli'));
      process.exit(1);
    }

    // 3. Run tree-sitter generate (generates C parser from grammar.js)
    //    tree-sitter runs grammar.js through Node.js, which fails in
    //    "type": "module" packages because grammar.js uses CommonJS.
    //    A temporary package.json in generated/ overrides the parent to CommonJS.
    spinner.text = 'Generating C parser...';
    const genDir = resolve(process.cwd(), 'generated');
    const genPkgJson = resolve(genDir, 'package.json');
    const hadPkgJson = existsSync(genPkgJson);

    if (!hadPkgJson) {
      writeFileSync(genPkgJson, '{"type":"commonjs"}\n');
    }

    try {
      execSync('tree-sitter generate generated/grammar.js', {
        stdio: 'pipe',
        cwd: process.cwd(),
      });
    } finally {
      if (!hadPkgJson) {
        rmSync(genPkgJson, { force: true });
      }
    }

    // 4. Run tree-sitter build --wasm (compiles to WebAssembly)
    spinner.text = 'Compiling to WASM...';
    execSync('tree-sitter build --wasm', {
      stdio: 'pipe',
      cwd: process.cwd(),
    });

    // 5. Move tree-sitter-*.wasm to generated/grammar.wasm
    //    tree-sitter outputs tree-sitter-{name}.wasm in cwd
    spinner.text = 'Moving WASM output...';
    const cwd = process.cwd();
    const wasmFiles = readdirSync(cwd).filter(
      f => f.startsWith('tree-sitter-') && f.endsWith('.wasm')
    );
    if (wasmFiles.length === 0) {
      spinner.fail('tree-sitter build --wasm did not produce a .wasm file');
      process.exit(1);
    }
    const sourceWasm = resolve(cwd, wasmFiles[0]!);
    const destWasm = resolve(cwd, 'generated', 'grammar.wasm');
    renameSync(sourceWasm, destWasm);

    // 6. Clean up tree-sitter generate artifacts (C source, bindings, etc.)
    const cleanupDirs = ['src', 'bindings'];
    const cleanupFiles = [
      'binding.gyp', 'Makefile', 'Package.swift', '.editorconfig',
    ];
    for (const dir of cleanupDirs) {
      const p = resolve(cwd, dir);
      if (existsSync(p)) {
        rmSync(p, { recursive: true, force: true });
      }
    }
    for (const file of cleanupFiles) {
      const p = resolve(cwd, file);
      if (existsSync(p)) {
        rmSync(p, { force: true });
      }
    }
    // Remove tree-sitter-{name}.pc files
    for (const f of readdirSync(cwd)) {
      if (f.startsWith('tree-sitter-') && f.endsWith('.pc')) {
        rmSync(resolve(cwd, f), { force: true });
      }
    }

    // 7. Bundle language server into a self-contained CJS file
    //    The entry point is created inline — no generated server.js needed.
    //    It imports treelsp/server and the user's grammar definition, then starts.
    spinner.text = 'Bundling language server...';

    const serverEntry = [
      `import { startStdioServer } from 'treelsp/server';`,
      `import { resolve, dirname } from 'node:path';`,
      `import { fileURLToPath } from 'node:url';`,
      `import definition from './grammar.js';`,
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
    const bundlePath = resolve(genDir, 'server.bundle.cjs');

    await esbuild({
      stdin: {
        contents: serverEntry,
        resolveDir: genDir,
        loader: 'js',
      },
      bundle: true,
      format: 'cjs',
      platform: 'node',
      outfile: bundlePath,
      nodePaths: [resolve(treelspPkg, 'node_modules')],
      logLevel: 'silent',
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
    const tsWasmDest = resolve(genDir, 'tree-sitter.wasm');
    if (existsSync(tsWasmSrc) && !existsSync(tsWasmDest)) {
      copyFileSync(tsWasmSrc, tsWasmDest);
    }

    spinner.succeed('Build complete');
    console.log(pc.dim('\nGenerated files:'));
    console.log(pc.dim('  generated/grammar.js'));
    console.log(pc.dim('  generated/grammar.wasm'));
    if (existsSync(resolve(genDir, 'server.bundle.cjs'))) {
      console.log(pc.dim('  generated/server.bundle.cjs'));
    }

  } catch (error) {
    spinner.fail('Build failed');

    if (error instanceof Error) {
      // execSync throws with stderr in the error object
      const execError = error as Error & { stderr?: Buffer };
      if (execError.stderr) {
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

    process.exit(1);
  }
}
