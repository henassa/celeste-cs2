import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Site 100 % statique : aucune requête réseau à l'exécution, tout est servi depuis le build.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  worker: { format: 'es' },
  // Exports du jeu (plusieurs Go) et outils : jamais surveillés ni analysés
  server: { watch: { ignored: ['**/map-sources/**', '**/tools/**'] } },
  optimizeDeps: { entries: ['index.html'] },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
