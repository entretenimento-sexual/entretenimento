// vitest.storage-rules.config.ts
// -----------------------------------------------------------------------------
// STORAGE RULES TEST CONFIGURATION
// -----------------------------------------------------------------------------
//
// Suíte executada em Node contra o Cloud Storage Emulator. Permanece isolada
// dos testes Angular e das Firestore Rules para produzir falhas diagnósticas.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'storage-rules',
    environment: 'node',
    include: ['storage-rules/tests/**/*.spec.ts'],
    globals: false,
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
