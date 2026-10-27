import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API/auth calls to the FastAPI backend on :8000.
// Production builds are served directly by FastAPI from frontend/dist.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/login': 'http://127.0.0.1:8000',
      '/logout': 'http://127.0.0.1:8000',
      '/static': 'http://127.0.0.1:8000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
