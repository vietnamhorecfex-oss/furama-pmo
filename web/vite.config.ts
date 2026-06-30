import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND = 'http://localhost:3001';

const proxy = {
  '/api': BACKEND,
  '/health': BACKEND,
  '/ready': BACKEND,
  '/socket.io': { target: BACKEND, ws: true },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy,
  },
  // preview (vite preview after build) needs the same proxy so E2E tests work
  preview: {
    port: 4173,
    proxy,
  },
});
