import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api/ingestion': `http://127.0.0.1:${process.env.INGESTION_API_PORT ?? 4318}` },
  },
  build: { outDir: 'dist/browser', emptyOutDir: true },
});
