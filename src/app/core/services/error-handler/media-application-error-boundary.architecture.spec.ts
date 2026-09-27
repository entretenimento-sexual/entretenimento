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

const LEGACY_MEDIA_HANDLE_ERROR_CALL = /\.handleError\s*\(/m;
const DIRECT_ERROR_NOTIFICATION_CALL =
  /\.(?:showError|showGenericError)\s*\(/m;

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

  it('impede retorno do adapter legado handleError', () => {
    const files = [
      ...SCANNED_DIRECTORIES.flatMap(collectRuntimeTypeScriptFiles),
      ...SCANNED_FILES,
    ];

    const violations = files
      .filter((filePath) =>
        LEGACY_MEDIA_HANDLE_ERROR_CALL.test(readFileSync(filePath, 'utf8'))
      )
      .map((filePath) =>
        relative(APP_ROOT, filePath).replaceAll('\\', '/')
      )
      .sort();

    expect(
      violations,
      'Use report()/reportSilently(); o adapter handleError foi removido.'
    ).toEqual([]);

    const mediaBoundary = readFileSync(
      resolve(APP_ROOT, 'core/services/media/media-application-error.service.ts'),
      'utf8'
    );
    expect(mediaBoundary).not.toMatch(/\bhandleError\s*\(/);
  });

  it('impede apresentação direta de erro técnico em Media', () => {
    const files = [
      ...SCANNED_DIRECTORIES.flatMap(collectRuntimeTypeScriptFiles),
      ...SCANNED_FILES,
    ];

    const violations = files
      .filter((filePath) => {
        const source = readFileSync(filePath, 'utf8');

        if (
          filePath.endsWith(
            'core/services/media/media-application-error.service.ts'
          )
        ) {
          return false;
        }

        return DIRECT_ERROR_NOTIFICATION_CALL.test(source);
      })
      .map((filePath) =>
        relative(APP_ROOT, filePath).replaceAll('\\', '/')
      )
      .sort();

    expect(
      violations,
      [
        'Erros técnicos de Media não devem usar showError/showGenericError',
        'diretamente. Use MediaApplicationErrorService; mantenha',
        'ErrorNotificationService apenas para sucesso, informação e avisos',
        'esperados de validação/estado.',
      ].join(' ')
    ).toEqual([]);
  });

  it('mantém catálogo reason -> mensagem -> presentation completo', () => {
    const catalog = readFileSync(
      resolve(APP_ROOT, 'core/services/media/media-error.catalog.ts'),
      'utf8'
    );
    const boundary = readFileSync(
      resolve(APP_ROOT, 'core/services/media/media-application-error.service.ts'),
      'utf8'
    );

    expect(catalog).toContain('MEDIA_ERROR_MESSAGES');
    expect(catalog).toContain('MEDIA_ERROR_PRESENTATIONS');
    expect(catalog).toContain('resolveMediaErrorMessage');
    expect(catalog).toContain('resolveMediaErrorPresentation');
    expect(boundary).toContain('reasonMessages: MEDIA_ERROR_MESSAGES');
    expect(boundary).toContain('reasonPresentations: MEDIA_ERROR_PRESENTATIONS');
    expect(boundary).toContain('reasonHint');
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
