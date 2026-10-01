import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localApi } from './server/vitePlugin';

export default defineConfig({
  base: '/',
  plugins: [react(), localApi()],
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
  },
} as never);
