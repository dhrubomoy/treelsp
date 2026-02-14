/**
 * Generate command - emit grammar.js, AST types, server.ts
 */

import ora from 'ora';
import pc from 'picocolors';

export async function generate(options: { watch?: boolean }) {
  const spinner = ora('Generating grammar.js...').start();

  // TODO: Implement codegen
  // 1. Load language definition
  // 2. Generate grammar.js
  // 3. Generate AST types
  // 4. Generate server.ts

  spinner.succeed('Generated grammar.js, ast.ts, server.ts');

  if (options.watch) {
    console.log(pc.dim('\nWatching for changes...'));
    // TODO: Watch mode
  }
}
