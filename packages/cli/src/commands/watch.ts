/**
 * Watch command - re-run generate + build on changes
 */

import chokidar from 'chokidar';
import pc from 'picocolors';
import { existsSync } from 'node:fs';
import { generate } from './generate.js';
import { build } from './build.js';

export async function watch() {
  console.log(pc.bold('treelsp watch\n'));

  // Check that grammar.ts exists before starting watch
  if (!existsSync('grammar.ts')) {
    console.error(pc.red('Could not find grammar.ts in current directory'));
    console.log(pc.dim('\nRun "treelsp init" to create a new language project'));
    process.exit(1);
  }

  const watcher = chokidar.watch('grammar.ts', {
    persistent: true,
    // Debounce rapid changes
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  let isBuilding = false;

  watcher.on('change', (path) => {
    void (async () => {
      if (isBuilding) {
        console.log(pc.dim('Build in progress, skipping...'));
        return;
      }

      console.log(pc.dim(`\n${path} changed`));
      isBuilding = true;

      try {
        await generate({});
        await build();
        console.log(pc.green('✓ Rebuild successful\n'));
      } catch (_error) {
        // Errors are already logged by generate/build commands
        // Just note the failure and continue watching
        console.log(pc.red('✗ Rebuild failed\n'));
      } finally {
        isBuilding = false;
        console.log(pc.dim('Watching for changes...'));
      }
    })();
  });

  watcher.on('error', (error) => {
    console.error(pc.red('Watcher error:'), error instanceof Error ? error.message : String(error));
  });

  console.log(pc.dim('Running initial build...\n'));

  // Initial build
  try {
    await generate({});
    await build();
    console.log(pc.green('✓ Initial build successful\n'));
  } catch (_error) {
    console.log(pc.red('✗ Initial build failed\n'));
  }

  console.log(pc.dim('Watching for changes...'));
}
