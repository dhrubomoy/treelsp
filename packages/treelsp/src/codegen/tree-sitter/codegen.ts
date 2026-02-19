/**
 * Tree-sitter codegen backend
 *
 * Implements ParserBackendCodegen for Tree-sitter.
 * Used by the CLI during `treelsp generate` and `treelsp build`.
 */

import type { LanguageDefinition } from '../../definition/index.js';
import type {
  ParserBackendCodegen,
  BuildArtifact,
  CompileOptions,
  CleanupPatterns,
  RuntimeFile,
} from '../../runtime/parser/backend.js';
import { resolve } from 'node:path';
import { generateGrammar } from './grammar.js';
import { generateHighlights } from './highlights.js';
import { generateLocals } from './locals.js';

export interface TreeSitterCodegenOptions {
  /** Absolute path to the tree-sitter binary. If not provided, assumes 'tree-sitter' is on PATH. */
  treeSitterBin?: string;
}

export class TreeSitterCodegen implements ParserBackendCodegen {
  readonly id = 'tree-sitter';
  private readonly treeSitterBin: string;

  constructor(options?: TreeSitterCodegenOptions) {
    this.treeSitterBin = options?.treeSitterBin ?? 'tree-sitter';
  }

  generate(definition: LanguageDefinition): BuildArtifact[] {
    return [
      { path: 'grammar.js', content: generateGrammar(definition) },
      { path: 'queries/highlights.scm', content: generateHighlights(definition) },
      { path: 'queries/locals.scm', content: generateLocals(definition) },
    ];
  }

  async compile(
    projectDir: string,
    outDir: string,
    options?: CompileOptions,
  ): Promise<void> {
    const { execSync } = await import('node:child_process');
    const { existsSync, copyFileSync, readdirSync, renameSync, writeFileSync, rmSync } = await import('node:fs');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { relative } = await import('node:path');

    const treeSitterBin = this.treeSitterBin;

    // 1. Check that grammar.js exists
    const grammarJsPath = resolve(outDir, 'grammar.js');
    if (!existsSync(grammarJsPath)) {
      throw new Error(`grammar.js not found at ${grammarJsPath}`);
    }

    // 2. Run tree-sitter generate (generates C parser from grammar.js)
    options?.onProgress?.('Generating C parser...');
    const genPkgJson = resolve(outDir, 'package.json');
    const hadPkgJson = existsSync(genPkgJson);

    if (!hadPkgJson) {
      writeFileSync(genPkgJson, '{"type":"commonjs"}\n');
    }

    const relGrammarJs = relative(projectDir, grammarJsPath);

    try {
      execSync(`${treeSitterBin} generate ${relGrammarJs}`, {
        stdio: 'pipe',
        cwd: projectDir,
      });
    } finally {
      if (!hadPkgJson) {
        rmSync(genPkgJson, { force: true });
      }
    }

    // 3. Copy external scanner source if present
    for (const scannerFile of ['scanner.c', 'scanner.cc']) {
      const scannerSrc = resolve(projectDir, scannerFile);
      const scannerDest = resolve(projectDir, 'src', scannerFile);
      if (existsSync(scannerSrc)) {
        copyFileSync(scannerSrc, scannerDest);
      }
    }

    // 4. Run tree-sitter build --wasm
    options?.onProgress?.('Compiling to WASM...');
    execSync(`${treeSitterBin} build --wasm`, {
      stdio: 'pipe',
      cwd: projectDir,
    });

    // 5. Move tree-sitter-*.wasm to outDir/grammar.wasm
    options?.onProgress?.('Moving WASM output...');
    const wasmFiles = readdirSync(projectDir).filter(
      f => f.startsWith('tree-sitter-') && f.endsWith('.wasm')
    );
    if (wasmFiles.length === 0) {
      throw new Error('tree-sitter build --wasm did not produce a .wasm file');
    }
    const sourceWasm = resolve(projectDir, wasmFiles[0]!);
    const destWasm = resolve(outDir, 'grammar.wasm');
    renameSync(sourceWasm, destWasm);
  }

  readonly cleanupPatterns: CleanupPatterns = {
    directories: ['src', 'bindings'],
    files: ['binding.gyp', 'Makefile', 'Package.swift', '.editorconfig'],
    globs: ['tree-sitter-*.pc'],
  };

  getRuntimeFiles(treelspPkgDir: string): RuntimeFile[] {
    const tsWasmSrc = resolve(treelspPkgDir, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm');
    return [{ src: tsWasmSrc, dest: 'tree-sitter.wasm' }];
  }
}
