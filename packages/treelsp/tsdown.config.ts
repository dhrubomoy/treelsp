import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'codegen/index': 'src/codegen/index.ts',
    'codegen/tree-sitter/index': 'src/codegen/tree-sitter/index.ts',
    'runtime/index': 'src/runtime/index.ts',
    'backend/tree-sitter/index': 'src/backend/tree-sitter/index.ts',
    'codegen/lezer/index': 'src/codegen/lezer/index.ts',
    'backend/lezer/index': 'src/backend/lezer/index.ts',
    'server/index': 'src/server/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  platform: 'node',
  external: [/^node:/, '@lezer/generator', 'esbuild'],
});
