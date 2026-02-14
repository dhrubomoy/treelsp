#!/usr/bin/env node

/**
 * treelsp CLI
 * Commands: init, generate, build, watch
 */

import { Command } from 'commander';
import { init } from './commands/init.js';
import { generate } from './commands/generate.js';
import { build } from './commands/build.js';
import { watch } from './commands/watch.js';

const program = new Command();

program
  .name('treelsp')
  .description('CLI for treelsp - LSP generator using Tree-sitter')
  .version('0.0.1');

program
  .command('init')
  .description('Scaffold a new language project')
  .action(init);

program
  .command('generate')
  .description('Generate grammar.js, AST types, and server from language definition')
  .option('-w, --watch', 'Watch for changes')
  .action(generate);

program
  .command('build')
  .description('Compile grammar.js to WASM using Tree-sitter CLI')
  .action(build);

program
  .command('watch')
  .description('Watch mode - re-run generate + build on changes')
  .action(watch);

program.parse();
