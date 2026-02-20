import { describe, it, expect } from 'vitest';
import { generateManifest } from './server.js';
import type { LanguageDefinition } from '../definition/index.js';

/** Minimal language definition for testing */
function createTestDefinition(): LanguageDefinition<'program' | 'identifier'> {
  return {
    name: 'TestLang',
    fileExtensions: ['.test'],
    entry: 'program',
    word: 'identifier',
    grammar: {
      program: r => r.repeat(r.rule('identifier')),
      identifier: r => r.token(/[a-z]+/),
    },
  };
}

describe('generateManifest', () => {
  it('generates valid JSON', () => {
    const result = generateManifest(createTestDefinition());
    const parsed = JSON.parse(result);
    expect(parsed).toBeDefined();
  });

  it('includes language metadata', () => {
    const result = JSON.parse(generateManifest(createTestDefinition()));
    expect(result.name).toBe('TestLang');
    expect(result.languageId).toBe('testlang');
    expect(result.fileExtensions).toEqual(['.test']);
    expect(result.server).toBe('./server.bundle.cjs');
    expect(result.queries).toEqual({
      highlights: './queries/highlights.scm',
      locals: './queries/locals.scm',
    });
    expect(result.textmateGrammar).toBe('./syntax.tmLanguage.json');
  });

  it('uses lowercase language ID', () => {
    const def = createTestDefinition();
    def.name = 'MyLANG';
    const result = JSON.parse(generateManifest(def));
    expect(result.languageId).toBe('mylang');
  });
});
