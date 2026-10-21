import { defineConfig } from 'vite';

// Static build for GitHub Pages / Netlify / Vercel. base './' keeps every asset path relative,
// so the same dist/ works at a domain root or under a sub-path such as /room-viewer/.
// Two pages: the 3D rooms (index.html) and the lookbook (lookbook/index.html), on the same site so
// they share this browser's storage (My Picks) and the data/ folder.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: { main: 'index.html', lookbook: 'lookbook/index.html' } },
  },
  server: { host: true },
});
