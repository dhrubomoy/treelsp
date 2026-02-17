/**
 * Watch command - re-run generate + build on changes
 */

import chokidar from 'chokidar';
import pc from 'picocolors';
import { relative } from 'node:path';
import { existsSync } from 'node:fs';
import { generateProject } from './generate.js';
import { buildProject } from './build.js';
import type { ConfigResult, ResolvedLanguageProject } from '../config.js';

export async function watch(configResult: ConfigResult) {
  console.log(pc.bold('treelsp watch\n'));

  const { projects } = configResult;

  // Build a map from grammar file path to project for quick lookup
  const projectByGrammar = new Map<string, ResolvedLanguageProject>();
  const grammarPaths: string[] = [];

  for (const project of projects) {
    if (!existsSync(project.grammarPath)) {
      console.error(pc.red(`Could not find ${relative(process.cwd(), project.grammarPath)}`));
      process.exit(1);
    }
    projectByGrammar.set(project.grammarPath, project);
    grammarPaths.push(project.grammarPath);
  }

  if (projects.length > 1) {
    console.log(pc.dim(`Watching ${String(projects.length)} language projects:`));
    for (const p of projects) {
      console.log(pc.dim(`  - ${relative(process.cwd(), p.grammarPath)}`));
    }
    console.log('');
  }

  const watcher = chokidar.watch(grammarPaths, {
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  let isBuilding = false;

  watcher.on('change', (changedPath) => {
    void (async () => {
      if (isBuilding) {
        console.log(pc.dim('Build in progress, skipping...'));
        return;
      }

      const project = projectByGrammar.get(changedPath);
      if (!project) return;

      console.log(pc.dim(`\n${relative(process.cwd(), changedPath)} changed`));
      isBuilding = true;

      try {
        await generateProject(project);
        await buildProject(project);
        console.log(pc.green('  Rebuild successful\n'));
      } catch {
        console.log(pc.red('  Rebuild failed\n'));
      } finally {
        isBuilding = false;
        console.log(pc.dim('Watching for changes...'));
      }
    })();
  });

  watcher.on('error', (error) => {
    console.error(pc.red('Watcher error:'), error instanceof Error ? error.message : String(error));
  });

  // Initial build
  console.log(pc.dim('Running initial build...\n'));
  for (const project of projects) {
    try {
      await generateProject(project);
      await buildProject(project);
    } catch {
      console.log(pc.red(`  ${relative(process.cwd(), project.projectDir)} - FAILED\n`));
    }
  }

  console.log(pc.dim('\nWatching for changes...'));
}
