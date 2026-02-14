/**
 * Watch command - re-run generate + build on changes
 */

import chokidar from 'chokidar';
import pc from 'picocolors';
import { generate } from './generate.js';
import { build } from './build.js';

export async function watch() {
  console.log(pc.bold('treelsp watch\n'));
  console.log(pc.dim('Watching for changes...\n'));

  const watcher = chokidar.watch('grammar.ts', {
    persistent: true,
  });

  watcher.on('change', async (path) => {
    console.log(pc.dim(`\n${path} changed`));
    await generate({});
    await build();
  });

  // Initial build
  await generate({});
  await build();
}
