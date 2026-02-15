import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'codegen/index': 'src/codegen/index.ts',
    'runtime/index': 'src/runtime/index.ts',
    'server/index': 'src/server/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  platform: 'neutral',
});
