import {
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_ROOT = resolve(process.cwd(), 'src/app');

const DIRECT_GLOBAL_ERROR_IMPORT =
  /import\s*\{[^}]*\bGlobalErrorHandlerService\b[^}]*\}\s*from\s*['"][^'"]*global-error-handler\.service['"]/m;

const SCANNED_DIRECTORIES = [
  resolve(APP_ROOT, 'core/services/media'),
  resolve(APP_ROOT, 'media'),
  resolve(APP_ROOT, 'photo-editor/photo-editor'),
];

const SCANNED_FILES = [
  resolve(APP_ROOT, 'core/services/image-handling/storage.service.ts'),
  resolve(APP_ROOT, 'core/services/image-handling/photo-firestore.service.ts'),
  resolve(APP_ROOT, 'core/services/image-handling/photo-upload-flow.service.ts'),
];

function collectRuntimeTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
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

describe('Media application error boundary', () => {
  it('impede acesso direto de mídia ao GlobalErrorHandlerService', () => {
    const files = [
      ...SCANNED_DIRECTORIES.flatMap(collectRuntimeTypeScriptFiles),
      ...SCANNED_FILES,
    ];

    const violations = files
      .filter((filePath) =>
        DIRECT_GLOBAL_ERROR_IMPORT.test(readFileSync(filePath, 'utf8'))
      )
      .map((filePath) =>
        relative(APP_ROOT, filePath).replaceAll('\\', '/')
      )
      .sort();

    expect(
      violations,
      [
        'Mídia não deve importar GlobalErrorHandlerService diretamente.',
        'Use MediaApplicationErrorService/ApplicationErrorService para preservar',
        'apresentação canônica, diagnóstico sanitizado e ausência de toast duplicado.',
      ].join(' ')
    ).toEqual([]);
  });

  it('mantém a topologia ApplicationError -> notifier + diagnóstico global', () => {
    const mediaBoundary = readFileSync(
      resolve(APP_ROOT, 'core/services/media/media-application-error.service.ts'),
      'utf8'
    );
    const applicationBoundary = readFileSync(
      resolve(APP_ROOT, 'core/services/error-handler/application-error.service.ts'),
      'utf8'
    );

    expect(mediaBoundary).toContain('ApplicationErrorService');
    expect(mediaBoundary).toContain("feature: 'media'");
    expect(applicationBoundary).toContain('ErrorNotificationService');
    expect(applicationBoundary).toContain('GlobalErrorHandlerService');
    expect(applicationBoundary).toContain('skipUserNotification = true');
  });
});
