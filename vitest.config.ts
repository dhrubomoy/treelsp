import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'packages/treelsp/src/**/*.ts',
        'packages/examples/mini-lang/grammar.ts',
        'packages/examples/mini-lang/generated/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
    },
  },
});
