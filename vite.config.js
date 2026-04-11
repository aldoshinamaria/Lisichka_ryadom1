import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages: приложение в подпапке /имя-репозитория/
// На GitHub Actions переменная GITHUB_REPOSITORY задаётся автоматически (owner/repo).
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const pagesBase = repoName ? `/${repoName}/` : '/lisichka-ryadom/';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'serve' ? '/' : pagesBase,
}));
