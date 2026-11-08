/// <reference types='vitest' />
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/asid-sender-protocol',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: [
      'default',
      ['json', { outputFile: '../../.test-timings/asid-sender-protocol.json' }],
    ],
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      reportsDirectory: '../../coverage/libs/asid-sender-protocol',
      provider: 'v8' as const,
    },
  },
}));
