import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: 'https://ai-prescripto.onrender.com/',
  server: {
    port: 5173,
  },
});
