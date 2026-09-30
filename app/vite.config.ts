import path from 'node:path';

import {
  fusionOpenPlugin,
  manifestCspPlugin,
  mkcertPlugin,
} from '@cognite/app-sdk/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // manifestCspPlugin() must stay first — its middleware sets the
  // Content-Security-Policy header before any HTML response is sent.
  plugins: [manifestCspPlugin(), react(), mkcertPlugin(), fusionOpenPlugin(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3001,
  },
  worker: {
    format: 'es',
  },
});
