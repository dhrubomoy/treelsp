/**
 * Generate command - emit grammar.js, AST types, treelsp.json
 */

import ora from 'ora';
import pc from 'picocolors';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, unlinkSync } from 'node:fs';
import { build as esbuildBuild } from 'esbuild';
import { generateAstTypes, generateManifest, generateTextmate } from 'treelsp/codegen';
import type { LanguageDefinition } from 'treelsp';
import type { ResolvedLanguageProject, ConfigResult } from '../config.js';
import { getCodegenBackend } from '../backends.js';

/**
 * Generate code for a single language project.
 */
export async function generateProject(project: ResolvedLanguageProject): Promise<void> {
  const label = relative(process.cwd(), project.grammarPath) || project.grammarPath;
  const spinner = ora(`Loading ${label}...`).start();

  try {
    if (!existsSync(project.grammarPath)) {
      spinner.fail(`Could not find ${label}`);
      console.log(pc.dim('\nRun "treelsp init" to create a new language project'));
      throw new Error(`Grammar file not found: ${project.grammarPath}`);
    }

    // Transpile grammar.ts via esbuild so it works on any Node version
    // (Node <23.6 can't import .ts files natively)
    const tmpPath = project.grammarPath.replace(/\.ts$/, '.tmp.mjs');
    await esbuildBuild({
      entryPoints: [project.grammarPath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: tmpPath,
      packages: 'external',
      logLevel: 'silent',
    });

    let definition: LanguageDefinition<string>;
    try {
      const grammarUrl = pathToFileURL(tmpPath).href;
      const mod = await import(grammarUrl) as { default: LanguageDefinition<string> };
      definition = mod.default;
    } finally {
      try { unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
    }

    if (!definition || !definition.name || !definition.grammar) {
      spinner.fail('Invalid language definition');
      console.log(pc.dim('\nEnsure grammar.ts exports a valid language definition using defineLanguage()'));
      throw new Error('Invalid language definition');
    }

    spinner.text = `Generating code for ${definition.name}...`;

    // Resolve the parser backend
    const backend = await getCodegenBackend(project.backend);

    // Generate backend-specific artifacts (grammar, queries, etc.)
    const artifacts = backend.generate(definition);

    // Generate shared artifacts (AST types, manifest, TextMate grammar)
    const astTypes = generateAstTypes(definition);
    const manifest = generateManifest(definition);
    const textmateGrammar = generateTextmate(definition);

    // Ensure output directory exists
    await mkdir(project.outDir, { recursive: true });

    // Create subdirectories needed by artifacts (e.g., queries/)
    const artifactDirs = new Set(
      artifacts
        .map(a => a.path.includes('/') ? resolve(project.outDir, a.path, '..') : null)
        .filter((d): d is string => d !== null)
    );
    for (const dir of artifactDirs) {
      await mkdir(dir, { recursive: true });
    }

    // Write all files
    await Promise.all([
      // Backend-specific artifacts
      ...artifacts.map(a =>
        writeFile(resolve(project.outDir, a.path), a.content, 'utf-8')
      ),
      // Shared artifacts
      writeFile(resolve(project.outDir, 'ast.ts'), astTypes, 'utf-8'),
      writeFile(resolve(project.outDir, 'treelsp.json'), manifest, 'utf-8'),
      writeFile(resolve(project.outDir, 'syntax.tmLanguage.json'), textmateGrammar, 'utf-8'),
    ]);

    const outLabel = relative(process.cwd(), project.outDir) || project.outDir;
    spinner.succeed(`Generated ${definition.name} -> ${outLabel}/`);

  } catch (error) {
    if (!spinner.isSpinning) {
      // spinner already stopped by fail() above
    } else {
      spinner.fail(`Generation failed for ${label}`);
    }

    if (error instanceof Error) {
      if (error.message.includes('Cannot find module')) {
        console.error(pc.red('\nFailed to load grammar file'));
        console.log(pc.dim('Ensure the file exists and has no syntax errors'));
      } else if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
        console.error(pc.red(`\nPermission denied writing to ${project.outDir}`));
        console.log(pc.dim('Check file permissions'));
      } else {
        console.error(pc.red(`\n${error.message}`));
      }
    }

    throw error;
  }
}

/**
 * Top-level generate command handler.
 */
export async function generate(options: { watch?: boolean }, configResult: ConfigResult): Promise<void> {
  for (const project of configResult.projects) {
    await generateProject(project);
  }

  if (!options.watch) {
    console.log(pc.dim('\nNext step: Run "treelsp build" to compile grammar to WASM'));
  }
}
