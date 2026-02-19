/**
 * Lezer codegen backend
 *
 * Implements ParserBackendCodegen for Lezer.
 * Used by the CLI during `treelsp generate` and `treelsp build`.
 */

import type { LanguageDefinition } from '../../definition/index.js';
import type {
  ParserBackendCodegen,
  BuildArtifact,
  CompileOptions,
} from '../../runtime/parser/backend.js';
import { generateLezerGrammar } from './grammar.js';
import { generateParserMeta } from './field-map.js';
import { generateExternalTokens } from './external-tokens.js';

export class LezerCodegen implements ParserBackendCodegen {
  readonly id = 'lezer';

  generate(definition: LanguageDefinition): BuildArtifact[] {
    const artifacts: BuildArtifact[] = [
      { path: 'grammar.lezer', content: generateLezerGrammar(definition) },
      { path: 'parser-meta.json', content: JSON.stringify(generateParserMeta(definition), null, 2) },
    ];

    const externalTokens = generateExternalTokens(definition);
    if (externalTokens) {
      artifacts.push({ path: 'tokens.js', content: externalTokens });
    }

    return artifacts;
  }

  async compile(
    _projectDir: string,
    outDir: string,
    options?: CompileOptions,
  ): Promise<void> {
    const fs = await import('node:fs');
    const nodePath = await import('node:path');
    const nodeUrl = await import('node:url');

    // 1. Read the grammar file
    const grammarPath = nodePath.resolve(outDir, 'grammar.lezer');
    if (!fs.existsSync(grammarPath)) {
      throw new Error(`grammar.lezer not found at ${grammarPath}`);
    }

    const grammarText = fs.readFileSync(grammarPath, 'utf-8');

    // 2. Compile using @lezer/generator
    options?.onProgress?.('Compiling Lezer grammar...');

    const { buildParserFile } = await import('@lezer/generator') as {
      buildParserFile: (spec: string, options?: { moduleStyle?: string; warn?: (msg: string) => void }) => { parser: string; terms: string };
    };

    let result: { parser: string; terms: string };
    try {
      result = buildParserFile(grammarText, {
        moduleStyle: 'es',
        warn: (msg) => {
          options?.onProgress?.(`Warning: ${msg}`);
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Lezer grammar compilation failed: ${message}`);
    }

    // 3. Write parser.js and parser.terms.js
    options?.onProgress?.('Writing parser output...');
    fs.writeFileSync(nodePath.resolve(outDir, 'parser.js'), result.parser);
    fs.writeFileSync(nodePath.resolve(outDir, 'parser.terms.js'), result.terms);

    // 4. Bundle parser into a self-contained ESM module
    // This inlines @lezer/lr, tokens.js, and parser.terms.js
    // so the server bundle can load it at runtime without node_modules
    options?.onProgress?.('Bundling parser...');

    const { build: esbuild } = await import('esbuild') as {
      build: (options: Record<string, unknown>) => Promise<void>;
    };

    // Create a wrapper entry that exports both parser and metadata
    const wrapperEntry = [
      `export { parser } from './parser.js';`,
      `import meta from './parser-meta.json';`,
      `export { meta };`,
    ].join('\n');

    fs.writeFileSync(nodePath.resolve(outDir, '_parser-entry.js'), wrapperEntry);

    // Resolve the node_modules directory containing @lezer/lr so esbuild
    // can find it. The generated dir won't have its own node_modules.
    const lezerLrEntry = nodeUrl.fileURLToPath(import.meta.resolve('@lezer/lr'));
    let nodeModulesDir = nodePath.dirname(lezerLrEntry);
    while (nodeModulesDir !== '/' && !nodeModulesDir.endsWith('node_modules')) {
      nodeModulesDir = nodePath.dirname(nodeModulesDir);
    }

    await esbuild({
      stdin: {
        contents: wrapperEntry,
        resolveDir: outDir,
        loader: 'js',
      },
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: nodePath.resolve(outDir, 'parser.bundle.js'),
      logLevel: 'warning',
      loader: { '.json': 'json' },
      nodePaths: [nodeModulesDir],
    });

    // Clean up the intermediate wrapper
    fs.rmSync(nodePath.resolve(outDir, '_parser-entry.js'), { force: true });
  }
}
