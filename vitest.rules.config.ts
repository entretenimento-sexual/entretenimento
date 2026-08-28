// vitest.rules.config.ts
// -----------------------------------------------------------------------------
// FIRESTORE RULES TEST CONFIGURATION
// -----------------------------------------------------------------------------
//
// Suíte executada em ambiente Node, isolada dos testes Angular.
// Não carrega TestBed, DOM ou configurações visuais da aplicação.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'firestore-rules',
    environment: 'node',
    include: ['firestore-rules/tests/**/*.spec.ts'],
    globals: false,
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});