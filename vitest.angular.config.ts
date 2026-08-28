import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

function resolveMaxWorkers(): number {
  const configuredValue = Number.parseInt(
    process.env['VITEST_MAX_WORKERS'] ?? '2',
    10
  );

  return Number.isFinite(configuredValue) && configuredValue > 0
    ? configuredValue
    : 2;
}

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
    pool: 'threads',
    maxWorkers: resolveMaxWorkers(),
    fileParallelism: true,
    setupFiles: [fileURLToPath(new URL('./src/test/setup-vitest.ts', import.meta.url))],
  },
});
