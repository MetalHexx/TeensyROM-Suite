/// <reference types='vitest' />
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig(() => ({
  root: __dirname,
  base: './',
  cacheDir: '../../node_modules/.vite/apps/asid-sender',
  plugins: [nxViteTsPaths()],
  build: {
    outDir: '../../dist/apps/asid-sender',
    emptyOutDir: true,
  },
  worker: {
    format: 'es' as const,
  },
  test: {
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default', ['json', { outputFile: '../../.test-timings/asid-sender.json' }]],
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      reportsDirectory: '../../coverage/apps/asid-sender',
      provider: 'v8' as const,
    },
  },
}));
