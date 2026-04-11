import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// «./» — ассеты подставляются относительно index.html: работает на GitHub Pages
// с любым именем репозитория и при деплое в подпапку.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'serve' ? '/' : './',
}));
