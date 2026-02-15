/**
 * Build command - compile grammar.js to WASM
 */

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import ora from 'ora';
import pc from 'picocolors';

export function build() {
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

    // 3. Copy grammar.js to a temp directory for tree-sitter CLI
    //    tree-sitter runs grammar.js through Node.js, which fails in
    //    "type": "module" packages because grammar.js uses CommonJS.
    //    A temp directory without package.json defaults to CommonJS.
    spinner.text = 'Generating C parser...';
    const tmpBuildDir = resolve(tmpdir(), `treelsp-build-${Date.now()}`);
    mkdirSync(tmpBuildDir, { recursive: true });
    copyFileSync(grammarPath, resolve(tmpBuildDir, 'grammar.js'));

    try {
      execSync(`tree-sitter generate ${resolve(tmpBuildDir, 'grammar.js')}`, {
        stdio: 'pipe',
        cwd: process.cwd(),
      });
    } finally {
      rmSync(tmpBuildDir, { recursive: true, force: true });
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

    spinner.succeed('Compiled grammar.wasm');
    console.log(pc.dim('\nGenerated files:'));
    console.log(pc.dim('  generated/grammar.js'));
    console.log(pc.dim('  generated/grammar.wasm'));

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
