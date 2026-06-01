// vitest.angular.config.ts
// -----------------------------------------------------------------------------
// VITEST CONFIG — ANGULAR CLI TEST RUNNER
// -----------------------------------------------------------------------------
// Usada pelo comando:
//
//   npx ng test --watch=false
//
// Importante:
// - não usa setupFiles;
// - não carrega setup-vitest-direct.ts;
// - não chama getTestBed().initTestEnvironment();
// - deixa o Angular CLI inicializar o TestBed.
// -----------------------------------------------------------------------------

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
    css: true,
  },
});