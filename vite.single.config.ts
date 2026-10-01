/**
 * Single-file build (for hosting as one HTML page). React is loaded from cdnjs as UMD globals
 * instead of being bundled; JSX uses the classic runtime so it can target the React global.
 */
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  define: {
    // the single-file page has no server: cloud accounts are off, with a link to the website
    'import.meta.env.VITE_CLOUD': JSON.stringify('off'),
    'import.meta.env.VITE_SITE_URL': JSON.stringify(process.env.SITE_URL ?? ''),
  },
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    jsxInject: `import React from 'react'`,
  },
  build: {
    outDir: 'dist-single',
    emptyOutDir: true,
    rollupOptions: {
      external: ['react', 'react-dom', 'react-dom/client'],
      output: {
        format: 'iife',
        interop: 'auto',
        globals: { react: 'React', 'react-dom': 'ReactDOM', 'react-dom/client': 'ReactDOM' },
      },
    },
  },
});
