/**
 * Generate command - emit grammar.js, AST types, server.ts
 */

import ora from 'ora';
import pc from 'picocolors';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { generateGrammar, generateAstTypes, generateServer } from 'treelsp/codegen';
import type { LanguageDefinition } from 'treelsp';

export async function generate(options: { watch?: boolean }) {
  const spinner = ora('Loading grammar.ts...').start();

  try {
    // 1. Find grammar.ts in current working directory
    const grammarPath = resolve(process.cwd(), 'grammar.ts');

    if (!existsSync(grammarPath)) {
      spinner.fail('Could not find grammar.ts in current directory');
      console.log(pc.dim('\nRun "treelsp init" to create a new language project'));
      process.exit(1);
    }

    // 2. Dynamically import the language definition
    const grammarUrl = pathToFileURL(grammarPath).href;
    const module = await import(grammarUrl) as { default: LanguageDefinition<string> };
    const definition = module.default;

    if (!definition || !definition.name || !definition.grammar) {
      spinner.fail('Invalid language definition');
      console.log(pc.dim('\nEnsure grammar.ts exports a valid language definition using defineLanguage()'));
      process.exit(1);
    }

    spinner.text = `Generating code for ${definition.name}...`;

    // 3. Generate code artifacts
    const grammarJs = generateGrammar(definition);
    const astTypes = generateAstTypes(definition);
    const serverTs = generateServer(definition);

    // 4. Create generated/ directory
    const genDir = resolve(process.cwd(), 'generated');
    await mkdir(genDir, { recursive: true });

    // 5. Write output files
    await Promise.all([
      writeFile(resolve(genDir, 'grammar.js'), grammarJs, 'utf-8'),
      writeFile(resolve(genDir, 'ast.ts'), astTypes, 'utf-8'),
      writeFile(resolve(genDir, 'server.ts'), serverTs, 'utf-8'),
    ]);

    spinner.succeed('Generated grammar.js, ast.ts, server.ts');

    if (!options.watch) {
      console.log(pc.dim('\nNext step: Run "treelsp build" to compile grammar to WASM'));
    }

  } catch (error) {
    spinner.fail('Generation failed');

    if (error instanceof Error) {
      if (error.message.includes('Cannot find module')) {
        console.error(pc.red('\nFailed to load grammar.ts'));
        console.log(pc.dim('Ensure the file exists and has no syntax errors'));
      } else if (error.message.includes('EACCES') || error.message.includes('EPERM')) {
        console.error(pc.red('\nPermission denied writing to generated/'));
        console.log(pc.dim('Check file permissions in the current directory'));
      } else {
        console.error(pc.red(`\n${error.message}`));
      }
    }

    process.exit(1);
  }
}
