// src/app/core/services/error-handler/application-error-boundary.architecture.spec.ts
import {
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_ROOT = resolve(process.cwd(), 'src/app');

const CANONICAL_COMPOSITION_OWNER =
  'core/services/error-handler/application-error.service.ts';

const ERROR_NOTIFICATION_IMPORT =
  /import\s*\{[^}]*\bErrorNotificationService\b[^}]*\}\s*from\s*['"][^'"]*error-notification\.service['"]/m;

const GLOBAL_ERROR_HANDLER_IMPORT =
  /import\s*\{[^}]*\bGlobalErrorHandlerService\b[^}]*\}\s*from\s*['"][^'"]*global-error-handler\.service['"]/m;

function collectRuntimeTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const absolutePath = resolve(directory, entry);
      const stats = statSync(absolutePath);

      if (stats.isDirectory()) {
        return collectRuntimeTypeScriptFiles(absolutePath);
      }

      if (
        !entry.endsWith('.ts')
        || entry.endsWith('.spec.ts')
        || entry.endsWith('.test.ts')
      ) {
        return [];
      }

      return [absolutePath];
    });
}

function normalizedRelativePath(absolutePath: string): string {
  return relative(APP_ROOT, absolutePath).replaceAll('\\', '/');
}

function isCommunityOwned(relativePath: string): boolean {
  return relativePath.toLowerCase().includes('community');
}

describe('Application error ownership boundary', () => {
  it('impede composição manual de notifier + global handler fora de Comunidades', () => {
    const violations = collectRuntimeTypeScriptFiles(APP_ROOT)
      .map((absolutePath) => ({
        absolutePath,
        relativePath: normalizedRelativePath(absolutePath),
      }))
      .filter(({ relativePath }) => (
        relativePath !== CANONICAL_COMPOSITION_OWNER
        && !isCommunityOwned(relativePath)
      ))
      .filter(({ absolutePath }) => {
        const source = readFileSync(absolutePath, 'utf8');

        return ERROR_NOTIFICATION_IMPORT.test(source)
          && GLOBAL_ERROR_HANDLER_IMPORT.test(source);
      })
      .map(({ relativePath }) => relativePath)
      .sort();

    expect(
      violations,
      [
        'Fora de Comunidades, a composição ErrorNotificationService +',
        'GlobalErrorHandlerService pertence exclusivamente ao',
        'ApplicationErrorService. Migre o consumidor para a camada canônica.',
      ].join(' ')
    ).toEqual([]);
  });
});
