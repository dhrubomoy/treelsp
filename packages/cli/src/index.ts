#!/usr/bin/env node

/**
 * treelsp CLI
 * Commands: init, generate, build, watch
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { init } from './commands/init.js';
import { generate } from './commands/generate.js';
import { build } from './commands/build.js';
import { watch } from './commands/watch.js';
import { resolveConfig } from './config.js';

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
  .option('-f, --file <file>', 'Path to treelsp-config.json or package.json with treelsp field')
  .option('-w, --watch', 'Watch for changes')
  .action(async (options: { file?: string; watch?: boolean }) => {
    try {
      const config = resolveConfig(options.file);
      if (config.configPath) {
        console.log(pc.dim(`Using config: ${config.configPath}\n`));
      }
      await generate(options, config);
    } catch {
      process.exit(1);
    }
  });

program
  .command('build')
  .description('Compile grammar.js to WASM using Tree-sitter CLI')
  .option('-f, --file <file>', 'Path to treelsp-config.json or package.json with treelsp field')
  .action(async (options: { file?: string }) => {
    try {
      const config = resolveConfig(options.file);
      if (config.configPath) {
        console.log(pc.dim(`Using config: ${config.configPath}\n`));
      }
      await build(config);
    } catch {
      process.exit(1);
    }
  });

program
  .command('watch')
  .description('Watch mode - re-run generate + build on changes')
  .option('-f, --file <file>', 'Path to treelsp-config.json or package.json with treelsp field')
  .action(async (options: { file?: string }) => {
    const config = resolveConfig(options.file);
    if (config.configPath) {
      console.log(pc.dim(`Using config: ${config.configPath}\n`));
    }
    await watch(config);
  });

program.parse();
