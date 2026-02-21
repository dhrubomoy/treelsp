/**
 * Guard test — ensures build artifacts exist before integration tests run.
 *
 * Without this, integration tests silently skip via describe.skipIf when
 * grammar.wasm / parser.bundle.js are absent, and CI reports all green
 * while the most important tests are not actually running.
 *
 * Fix: run "pnpm build" before "pnpm test".
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const artifacts = {
  'mini-lang tree-sitter': resolve(__dirname, 'mini-lang/generated/grammar.wasm'),
  'mini-lang lezer': resolve(__dirname, 'mini-lang/generated-lezer/parser.bundle.js'),
  'mini-lang server bundle': resolve(__dirname, 'mini-lang/generated/server.bundle.cjs'),
  'schema-lang tree-sitter': resolve(__dirname, 'schema-lang/generated/grammar.wasm'),
  'schema-lang lezer': resolve(__dirname, 'schema-lang/generated-lezer/parser.bundle.js'),
  'indent-lang tree-sitter': resolve(__dirname, 'indent-lang/generated/grammar.wasm'),
  'indent-lang lezer': resolve(__dirname, 'indent-lang/generated-lezer/parser.bundle.js'),
};

describe('build artifacts (run "pnpm build" first)', () => {
  for (const [name, path] of Object.entries(artifacts)) {
    it(`${name} exists`, () => {
      expect(existsSync(path), `Missing: ${path}\nRun "pnpm build" to generate build artifacts.`).toBe(true);
    });
  }
});
