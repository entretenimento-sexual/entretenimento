import {
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_ROOT = resolve(process.cwd(), 'src/app');

const CANONICAL_NOTIFICATION_ERROR_OWNERS = [
  'core/services/notifications/app-notification.service.ts',
  'core/services/notifications/community-notification-preference.service.ts',
  'core/services/notifications/community-notification-unread-summary.service.ts',
  'core/services/notifications/notification-preferences.service.ts',
  'core/services/notifications/push-notification-device.service.ts',
  'core/services/batepapo/chat-notification.service.ts',
  'notifications/notifications-page/notifications-page.component.ts',
  'preferences/pages/notification-settings/notification-settings.component.ts',
] as const;

const PRESENTATION_INFRASTRUCTURE = new Set([
  'core/services/error-handler/error-notification.service.ts',
  'core/services/general/notification.service.ts',
]);

const NOTIFICATION_DOMAIN_MARKERS = [
  'AppNotificationService',
  'CommunityNotificationPreferenceService',
  'CommunityNotificationUnreadSummaryService',
  'NotificationPreferencesService',
  'PushNotificationDeviceService',
  'ChatNotificationService',
] as const;

const NOTIFICATION_PUBLIC_OPERATION_MARKERS = [
  '.markAsRead$(',
  '.markAllAsRead$(',
  '.updateMuted$(',
  '.updateCurrentPreferences$(',
] as const;

function source(relativePath: string): string {
  return readFileSync(resolve(APP_ROOT, relativePath), 'utf8');
}

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

function relativePath(absolutePath: string): string {
  return relative(APP_ROOT, absolutePath).replaceAll('\\\\', '/');
}

function notificationRuntimeFiles(): Array<{
  relativePath: string;
  source: string;
}> {
  return collectRuntimeTypeScriptFiles(APP_ROOT)
    .map((absolutePath) => ({
      relativePath: relativePath(absolutePath),
      source: readFileSync(absolutePath, 'utf8'),
    }))
    .filter(({ relativePath, source }) =>
      relativePath.toLowerCase().includes('notification')
      || NOTIFICATION_DOMAIN_MARKERS.some((marker) => source.includes(marker))
    );
}

function filesHandlingPublicNotificationErrors(): Array<{
  relativePath: string;
  source: string;
}> {
  return notificationRuntimeFiles().filter(({ source }) => {
    const handlesObservableError = /\berror\s*:\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(source)
      || /\berror\s*:\s*[A-Za-z_$][\w$]*\s*=>/.test(source);
    const usesPublicNotificationMutation =
      NOTIFICATION_PUBLIC_OPERATION_MARKERS.some((marker) => source.includes(marker))
      || (
        source.includes('PushNotificationDeviceService')
        && (
          source.includes('.activate$(')
          || source.includes('.deactivate$(')
          || source.includes('.refresh$(')
        )
      );

    return handlesObservableError && usesPublicNotificationMutation;
  });
}

describe('Notification error ownership boundary', () => {
  it('usa ApplicationErrorService como entrada canônica em todos os owners de erro', () => {
    for (const relativePath of CANONICAL_NOTIFICATION_ERROR_OWNERS) {
      expect(
        source(relativePath),
        relativePath
      ).toContain('ApplicationErrorService');
    }
  });

  it('não acessa GlobalErrorHandlerService diretamente em nenhum runtime de notificações', () => {
    const offenders = notificationRuntimeFiles()
      .filter(({ source }) => source.includes('GlobalErrorHandlerService'))
      .map(({ relativePath }) => relativePath)
      .sort();

    expect(offenders).toEqual([]);
  });

  it('não permite apresentação manual de erro em runtime de notificações', () => {
    const offenders = notificationRuntimeFiles()
      .filter(({ relativePath }) => !PRESENTATION_INFRASTRUCTURE.has(relativePath))
      .filter(({ source }) =>
        /\.showError\s*\(/.test(source)
        || /\.showNotification\s*\(\s*['"`]error['"`]/.test(source)
      )
      .map(({ relativePath }) => relativePath)
      .sort();

    expect(offenders).toEqual([]);
  });

  it('exige ApplicationErrorService quando consumidor trata erro de mutação de notificações', () => {
    const offenders = filesHandlingPublicNotificationErrors()
      .filter(({ source }) => !source.includes('ApplicationErrorService'))
      .map(({ relativePath }) => relativePath)
      .sort();

    expect(offenders).toEqual([]);
  });

  it('mantém ErrorNotificationService restrito a feedback não-erro nas duas telas', () => {
    const center = source(
      'notifications/notifications-page/notifications-page.component.ts'
    );
    const settings = source(
      'preferences/pages/notification-settings/notification-settings.component.ts'
    );
    const services = CANONICAL_NOTIFICATION_ERROR_OWNERS
      .filter((relativePath) => !relativePath.startsWith('notifications/')
        && !relativePath.startsWith('preferences/pages/notification-settings/'))
      .map(source);

    expect(center).toContain('ErrorNotificationService');
    expect(settings).toContain('ErrorNotificationService');

    for (const serviceSource of services) {
      expect(serviceSource).not.toContain('ErrorNotificationService');
    }
  });
});
