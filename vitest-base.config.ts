// vitest-base.config.ts
// -----------------------------------------------------------------------------
// VITEST BASE CONFIG
// -----------------------------------------------------------------------------
//
// Configuração usada para executar specs isolados diretamente pelo Vitest.
//
// Necessidade:
// - o TypeScript conhece os aliases via tsconfig;
// - o Vitest executado diretamente também precisa conhecê-los;
// - sem isso, imports como `src/environments/environment` falham antes mesmo
//   da execução do teste.
import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      src: fileURLToPath(new URL('./src', import.meta.url)),
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
      '@core': fileURLToPath(new URL('./src/app/core', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/app/shared', import.meta.url)),
      '@env': fileURLToPath(new URL('./src/environments', import.meta.url)),
      '@store': fileURLToPath(new URL('./src/app/store', import.meta.url)),
    },
  },

  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test/setup-vitest-direct.ts'],
    include: ['src/**/*.spec.ts'],
    css: true,
  },
});