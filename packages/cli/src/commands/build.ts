/**
 * Build command - compile grammar.js to WASM
 */

import { execSync } from 'child_process';
import ora from 'ora';
import pc from 'picocolors';

export async function build() {
  const spinner = ora('Compiling grammar to WASM...').start();

  try {
    // TODO: Check tree-sitter CLI is installed
    // TODO: Run tree-sitter generate
    // TODO: Run tree-sitter build-wasm

    spinner.succeed('Compiled grammar.wasm');
  } catch (error) {
    spinner.fail('Build failed');
    console.error(pc.red((error as Error).message));
    process.exit(1);
  }
}
