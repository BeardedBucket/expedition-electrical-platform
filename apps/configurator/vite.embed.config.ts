import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/embed',
    emptyOutDir: true,
    lib: {
      entry: resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/embed.tsx'),
      name: 'ExpeditionConfiguratorEmbed',
      fileName: 'configurator-embed',
      formats: ['iife', 'es'],
    },
    rollupOptions: {
      output: {
        assetFileNames: 'configurator-embed.[ext]',
      },
    },
  },
});
