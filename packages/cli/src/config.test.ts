/**
 * CLI config loading and validation tests
 */

import { describe, it, expect, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolveConfig } from './config.js';
import { getCodegenBackend } from './backends.js';

describe('config', () => {
  describe('resolveConfig', () => {
    it('throws for missing config file', () => {
      expect(() => resolveConfig('/nonexistent/treelsp-config.json')).toThrow('Config file not found');
    });

    it('loads treelsp-config.json from examples', () => {
      const examplesConfig = resolve(import.meta.dirname!, '..', '..', 'examples', 'treelsp-config.json');
      const result = resolveConfig(examplesConfig);

      expect(result.source).toBe('file');
      expect(result.configPath).toBe(examplesConfig);
      expect(result.projects.length).toBeGreaterThan(0);

      for (const project of result.projects) {
        expect(project.grammarPath).toMatch(/grammar\.ts$/);
        expect(project.projectDir).toBeTruthy();
        expect(project.outDir).toBeTruthy();
        expect(typeof project.backend).toBe('string');
      }
    });

    it('resolves backend to "tree-sitter" by default', () => {
      const examplesConfig = resolve(import.meta.dirname!, '..', '..', 'examples', 'treelsp-config.json');
      const result = resolveConfig(examplesConfig);

      const treeSitterProject = result.projects.find(p => !p.outDir.includes('lezer'));
      expect(treeSitterProject?.backend).toBe('tree-sitter');
    });

    it('resolves lezer backend when specified', () => {
      const examplesConfig = resolve(import.meta.dirname!, '..', '..', 'examples', 'treelsp-config.json');
      const result = resolveConfig(examplesConfig);

      const lezerProject = result.projects.find(p => p.backend === 'lezer');
      expect(lezerProject).toBeDefined();
      expect(lezerProject!.outDir).toMatch(/generated-lezer/);
    });
  });

  describe('config validation', () => {
    const tmpDir = resolve(import.meta.dirname!, '..', '.test-config-tmp');

    function withTempConfig(content: string): string {
      mkdirSync(tmpDir, { recursive: true });
      const path = resolve(tmpDir, 'treelsp-config.json');
      writeFileSync(path, content);
      return path;
    }

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('rejects non-object config', () => {
      const path = withTempConfig('"not an object"');
      expect(() => resolveConfig(path)).toThrow('expected an object');
    });

    it('rejects config without languages array', () => {
      const path = withTempConfig('{}');
      expect(() => resolveConfig(path)).toThrow('"languages" must be an array');
    });

    it('rejects empty languages array', () => {
      const path = withTempConfig('{"languages": []}');
      expect(() => resolveConfig(path)).toThrow('"languages" must not be empty');
    });

    it('rejects language without grammar field', () => {
      const path = withTempConfig('{"languages": [{}]}');
      expect(() => resolveConfig(path)).toThrow('grammar must be a non-empty string');
    });

    it('rejects language with empty grammar string', () => {
      const path = withTempConfig('{"languages": [{"grammar": ""}]}');
      expect(() => resolveConfig(path)).toThrow('grammar must be a non-empty string');
    });

    it('rejects language with empty out string', () => {
      const path = withTempConfig('{"languages": [{"grammar": "grammar.ts", "out": ""}]}');
      expect(() => resolveConfig(path)).toThrow('out must be a non-empty string');
    });

    it('accepts valid minimal config', () => {
      const path = withTempConfig('{"languages": [{"grammar": "grammar.ts"}]}');
      const result = resolveConfig(path);

      expect(result.source).toBe('file');
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0]!.grammarPath).toMatch(/grammar\.ts$/);
      expect(result.projects[0]!.backend).toBe('tree-sitter');
    });

    it('accepts config with custom out and backend', () => {
      const path = withTempConfig('{"languages": [{"grammar": "src/grammar.ts", "out": "dist", "backend": "lezer"}]}');
      const result = resolveConfig(path);

      expect(result.projects[0]!.backend).toBe('lezer');
      expect(result.projects[0]!.outDir).toMatch(/dist$/);
    });

    it('resolves paths relative to config file location', () => {
      const path = withTempConfig('{"languages": [{"grammar": "lang/grammar.ts"}]}');
      const result = resolveConfig(path);

      expect(result.projects[0]!.grammarPath).toBe(resolve(tmpDir, 'lang/grammar.ts'));
      expect(result.projects[0]!.projectDir).toBe(resolve(tmpDir, 'lang'));
      expect(result.projects[0]!.outDir).toBe(resolve(tmpDir, 'lang/generated'));
    });
  });
});

describe('backends', () => {
  it('rejects unknown backend', async () => {
    await expect(getCodegenBackend('unknown-backend')).rejects.toThrow('Unknown parser backend: "unknown-backend"');
  });

  it('error message lists available backends', async () => {
    await expect(getCodegenBackend('foo')).rejects.toThrow(/tree-sitter.*lezer/);
  });

  it('resolves tree-sitter backend', async () => {
    const backend = await getCodegenBackend('tree-sitter');
    expect(backend).toBeDefined();
    expect(typeof backend.generate).toBe('function');
    expect(typeof backend.compile).toBe('function');
  });

  it('resolves lezer backend', async () => {
    const backend = await getCodegenBackend('lezer');
    expect(backend).toBeDefined();
    expect(typeof backend.generate).toBe('function');
    expect(typeof backend.compile).toBe('function');
  });

  it('defaults to tree-sitter when no id given', async () => {
    const backend = await getCodegenBackend();
    expect(backend).toBeDefined();
    expect(typeof backend.generate).toBe('function');
  });
});
