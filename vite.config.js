import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Корень репозитория: index.html только редирект на docs/ (для GitHub Pages с источником «/ root»).
// Разработка и сборка — из папки app/ (там настоящая точка входа Vite).
export default defineConfig(({ command }) => ({
  root: path.join(projectRoot, 'app'),
  publicDir: path.join(projectRoot, 'public'),
  server: {
    fs: {
      allow: [projectRoot],
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      '/App.jsx': path.join(projectRoot, 'App.jsx'),
    },
  },
  base: command === 'serve' ? '/' : './',
  build: {
    outDir: path.join(projectRoot, 'docs'),
    emptyOutDir: true,
  },
}));
