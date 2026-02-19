import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('wasm loader', () => {
  beforeEach(() => {
    // Clear any module caches between tests
    vi.resetModules();
  });

  describe('platform detection', () => {
    it('should detect Node.js environment', () => {
      // In Node.js test environment, should detect as Node.js
      expect(typeof process).toBe('object');
      expect(process.versions?.node).toBeDefined();
    });
  });

  describe('module exports', () => {
    it('should export createParser function', async () => {
      const { createParser } = await import('./wasm.js');
      expect(typeof createParser).toBe('function');
    });

    it('should export loadLanguage function', async () => {
      const { loadLanguage } = await import('./wasm.js');
      expect(typeof loadLanguage).toBe('function');
    });

    it('should export preloadParser function', async () => {
      const { preloadParser } = await import('./wasm.js');
      expect(typeof preloadParser).toBe('function');
    });
  });

  // Note: Integration tests with actual WASM loading require a grammar.wasm file
  // Those tests will be in a separate integration test suite
});
