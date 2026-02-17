/**
 * Generate command - emit grammar.js, AST types, treelsp.json
 */

import ora from 'ora';
import pc from 'picocolors';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { generateGrammar, generateAstTypes, generateManifest, generateHighlights, generateLocals } from 'treelsp/codegen';
import type { LanguageDefinition } from 'treelsp';
import type { ResolvedLanguageProject, ConfigResult } from '../config.js';

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

    // Dynamically import the language definition
    const grammarUrl = pathToFileURL(project.grammarPath).href;
    const module = await import(grammarUrl) as { default: LanguageDefinition<string> };
    const definition = module.default;

    if (!definition || !definition.name || !definition.grammar) {
      spinner.fail('Invalid language definition');
      console.log(pc.dim('\nEnsure grammar.ts exports a valid language definition using defineLanguage()'));
      throw new Error('Invalid language definition');
    }

    spinner.text = `Generating code for ${definition.name}...`;

    // Generate code artifacts
    const grammarJs = generateGrammar(definition);
    const astTypes = generateAstTypes(definition);
    const manifest = generateManifest(definition);
    const highlightsSCM = generateHighlights(definition);
    const localsSCM = generateLocals(definition);

    // Create output directories
    const queriesDir = resolve(project.outDir, 'queries');
    await mkdir(queriesDir, { recursive: true });

    // Write output files
    await Promise.all([
      writeFile(resolve(project.outDir, 'grammar.js'), grammarJs, 'utf-8'),
      writeFile(resolve(project.outDir, 'ast.ts'), astTypes, 'utf-8'),
      writeFile(resolve(project.outDir, 'treelsp.json'), manifest, 'utf-8'),
      writeFile(resolve(queriesDir, 'highlights.scm'), highlightsSCM, 'utf-8'),
      writeFile(resolve(queriesDir, 'locals.scm'), localsSCM, 'utf-8'),
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
