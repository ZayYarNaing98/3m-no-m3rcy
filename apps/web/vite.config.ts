import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // `npm run dev -w @nomercy/worker` serves the API on 8787.
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
});
