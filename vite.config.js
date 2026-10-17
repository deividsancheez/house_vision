import { defineConfig } from 'vite';

// Static build for GitHub Pages / Netlify / Vercel. base './' keeps every asset path relative,
// so the same dist/ works at a domain root or under a sub-path such as /room-viewer/.
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
  server: { host: true },
});
