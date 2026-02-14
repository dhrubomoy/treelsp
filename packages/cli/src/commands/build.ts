/**
 * Build command - compile grammar.js to WASM
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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
    spinner.text = 'Generating C parser...';
    execSync('tree-sitter generate generated/grammar.js', {
      stdio: 'pipe',
      cwd: process.cwd(),
    });

    // 4. Run tree-sitter build-wasm (compiles to WebAssembly)
    spinner.text = 'Compiling to WASM...';
    execSync('tree-sitter build --wasm', {
      stdio: 'pipe',
      cwd: process.cwd(),
    });

    spinner.succeed('Compiled grammar.wasm');
    console.log(pc.dim('\nGenerated files:'));
    console.log(pc.dim('  generated/grammar.js'));
    console.log(pc.dim('  generated/grammar.wasm'));

  } catch (error) {
    spinner.fail('Build failed');

    if (error instanceof Error) {
      if ('stderr' in error && error.stderr) {
        const stderr = (error as any).stderr.toString();
        console.error(pc.red('\nTree-sitter error:'));
        console.error(pc.dim(stderr));

        if (stderr.includes('grammar.js')) {
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
