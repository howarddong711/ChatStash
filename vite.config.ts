import { crx } from '@crxjs/vite-plugin';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

import manifest from './manifest.json';

export default defineConfig({
  plugins: [tsconfigPaths(), crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        export: 'src/pages/export/index.html',
        options: 'src/pages/options/index.html',
      },
    },
  },
});
