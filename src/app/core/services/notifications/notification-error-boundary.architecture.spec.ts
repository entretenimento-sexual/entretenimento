import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

function source(relativePath: string): string {
  return readFileSync(resolve(APP_ROOT, relativePath), 'utf8');
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

  it('não acessa GlobalErrorHandlerService diretamente no domínio de notificações', () => {
    for (const relativePath of CANONICAL_NOTIFICATION_ERROR_OWNERS) {
      expect(
        source(relativePath),
        relativePath
      ).not.toContain('GlobalErrorHandlerService');
    }
  });

  it('não permite apresentação manual de erro nas bordas de notificações', () => {
    for (const relativePath of CANONICAL_NOTIFICATION_ERROR_OWNERS) {
      expect(
        source(relativePath),
        relativePath
      ).not.toMatch(/\.showError\s*\(/);
    }
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
