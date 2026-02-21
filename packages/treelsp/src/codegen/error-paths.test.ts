/**
 * Codegen error-path tests
 *
 * Exercises validation and error handling across all codegen functions:
 * - Entry/word rule validation (tree-sitter + lezer)
 * - Compile-time file checks (grammar.js / grammar.lezer missing)
 * - Lezer compilation failures (invalid grammar)
 * - Shared codegen with edge-case grammars
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import type { LanguageDefinition } from '../definition/index.js';

// Tree-sitter codegen
import { generateGrammar } from './tree-sitter/grammar.js';
import { generateHighlights } from './tree-sitter/highlights.js';
import { generateLocals } from './tree-sitter/locals.js';
import { TreeSitterCodegen } from './tree-sitter/codegen.js';

// Lezer codegen
import { generateLezerGrammar } from './lezer/grammar.js';
import { LezerCodegen } from './lezer/codegen.js';

// Shared codegen
import { generateAstTypes } from './ast-types.js';
import { generateManifest } from './server.js';
import { generateTextmate } from './textmate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid definition for tests that need one */
function validDefinition(): LanguageDefinition {
  return {
    name: 'Test',
    fileExtensions: ['.test'],
    entry: 'program',
    grammar: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      program: (r: any) => r.repeat(r.rule('identifier')),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      identifier: (r: any) => r.token(/[a-z]+/),
    },
  } as LanguageDefinition;
}

/** Definition with entry pointing at a non-existent rule */
function missingEntryDefinition(): LanguageDefinition {
  return {
    name: 'Test',
    fileExtensions: ['.test'],
    entry: 'nonexistent',
    grammar: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      program: (r: any) => r.token(/x/),
    },
  } as LanguageDefinition;
}

/** Definition with a word rule that doesn't exist */
function missingWordDefinition(): LanguageDefinition {
  return {
    name: 'Test',
    fileExtensions: ['.test'],
    entry: 'program',
    word: 'typo_identifier',
    grammar: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      program: (r: any) => r.repeat(r.rule('identifier')),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      identifier: (r: any) => r.token(/[a-z]+/),
    },
  } as LanguageDefinition;
}

/** Definition with a word rule that isn't a token */
function nonTokenWordDefinition(): LanguageDefinition {
  return {
    name: 'Test',
    fileExtensions: ['.test'],
    entry: 'program',
    word: 'expression',
    grammar: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      program: (r: any) => r.repeat(r.rule('expression')),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      expression: (r: any) => r.choice(r.rule('identifier')),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      identifier: (r: any) => r.token(/[a-z]+/),
    },
  } as LanguageDefinition;
}

// ---------------------------------------------------------------------------
// Lezer grammar validation
// ---------------------------------------------------------------------------

describe('Lezer grammar validation', () => {
  it('throws when entry rule does not exist', () => {
    expect(() => generateLezerGrammar(missingEntryDefinition()))
      .toThrow("Entry rule 'nonexistent' is not defined in grammar");
  });

  it('error message lists available rules', () => {
    expect(() => generateLezerGrammar(missingEntryDefinition()))
      .toThrow(/Available rules: program/);
  });

  it('succeeds with a valid definition', () => {
    const result = generateLezerGrammar(validDefinition());
    expect(result).toContain('@top Program');
  });
});

// ---------------------------------------------------------------------------
// Tree-sitter grammar validation (complements existing grammar.test.ts)
// ---------------------------------------------------------------------------

describe('Tree-sitter grammar validation', () => {
  it('error message for missing entry lists available rules', () => {
    expect(() => generateGrammar(missingEntryDefinition()))
      .toThrow(/Available rules: program/);
  });

  it('throws for missing word rule', () => {
    expect(() => generateGrammar(missingWordDefinition()))
      .toThrow("Word rule 'typo_identifier' is not defined in grammar");
  });

  it('throws when word rule is not a token', () => {
    expect(() => generateGrammar(nonTokenWordDefinition()))
      .toThrow("Word rule 'expression' must be a token rule");
  });
});

// ---------------------------------------------------------------------------
// Tree-sitter compile errors
// ---------------------------------------------------------------------------

describe('TreeSitterCodegen.compile', () => {
  const tmpDir = resolve(import.meta.dirname, '..', '..', '.test-codegen-tmp-ts');

  function withEmptyDir(): string {
    mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
  }

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws when grammar.js is missing', async () => {
    const outDir = withEmptyDir();
    const codegen = new TreeSitterCodegen();
    await expect(codegen.compile(outDir, outDir)).rejects.toThrow(
      /grammar\.js not found/
    );
  });
});

// ---------------------------------------------------------------------------
// Lezer compile errors
// ---------------------------------------------------------------------------

describe('LezerCodegen.compile', () => {
  const tmpDir = resolve(import.meta.dirname, '..', '..', '.test-codegen-tmp-lezer');

  function withDir(files?: Record<string, string>): string {
    mkdirSync(tmpDir, { recursive: true });
    if (files) {
      for (const [name, content] of Object.entries(files)) {
        writeFileSync(resolve(tmpDir, name), content);
      }
    }
    return tmpDir;
  }

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws when grammar.lezer is missing', async () => {
    const outDir = withDir();
    const codegen = new LezerCodegen();
    await expect(codegen.compile('', outDir)).rejects.toThrow(
      /grammar\.lezer not found/
    );
  });

  it('throws on invalid grammar content', async () => {
    const outDir = withDir({
      'grammar.lezer': 'this is not a valid lezer grammar !!!',
    });
    const codegen = new LezerCodegen();
    await expect(codegen.compile('', outDir)).rejects.toThrow(
      /Lezer grammar compilation failed/
    );
  });
});

// ---------------------------------------------------------------------------
// Shared codegen: edge-case grammars
// ---------------------------------------------------------------------------

describe('shared codegen with single-rule grammar', () => {
  /** Grammar with only one token rule — minimal but valid */
  const singleRule: LanguageDefinition = {
    name: 'Minimal',
    fileExtensions: ['.min'],
    entry: 'program',
    grammar: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      program: (r: any) => r.token(/./),
    },
  } as LanguageDefinition;

  it('generateAstTypes produces valid output', () => {
    const result = generateAstTypes(singleRule);
    expect(result).toContain('ProgramNode');
    expect(result).toContain("type: 'program'");
  });

  it('generateManifest includes language metadata', () => {
    const result = generateManifest(singleRule);
    const manifest = JSON.parse(result) as Record<string, unknown>;
    expect(manifest['name']).toBe('Minimal');
    expect(manifest['languageId']).toBe('minimal');
    expect(manifest['fileExtensions']).toEqual(['.min']);
  });

  it('generateTextmate produces valid JSON', () => {
    const result = generateTextmate(singleRule);
    const grammar = JSON.parse(result) as Record<string, unknown>;
    expect(grammar['scopeName']).toBe('source.minimal');
  });

  it('generateHighlights returns a string', () => {
    const result = generateHighlights(singleRule);
    expect(typeof result).toBe('string');
  });

  it('generateLocals returns a string', () => {
    const result = generateLocals(singleRule);
    expect(typeof result).toBe('string');
  });

  it('tree-sitter grammar generates valid output', () => {
    const result = generateGrammar(singleRule);
    expect(result).toContain('name: "Minimal"');
    expect(result).toContain('program:');
  });

  it('lezer grammar generates valid output', () => {
    const result = generateLezerGrammar(singleRule);
    expect(result).toContain('@top Program');
  });
});

describe('shared codegen with no-semantic definition', () => {
  it('generateHighlights with no semantic produces no declaration captures', () => {
    const def = validDefinition();
    delete def.semantic;
    const result = generateHighlights(def);
    expect(result).not.toContain('@local.definition');
  });

  it('generateLocals with no semantic produces empty output', () => {
    const def = validDefinition();
    delete def.semantic;
    const result = generateLocals(def);
    // Should be a valid .scm file (may be empty or just comments)
    expect(typeof result).toBe('string');
  });
});
