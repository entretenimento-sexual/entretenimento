import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { firstValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PushNotificationDeviceService } from 'src/app/core/services/notifications/push-notification-device.service';
import { environment } from 'src/environments/environment';

describe('PushNotificationDeviceService', () => {
  const requestPermission = vi.fn<() => Promise<NotificationPermission>>();
  const originalWebPush = environment.webPush;
  const originalNotification = Object.getOwnPropertyDescriptor(
    globalThis,
    'Notification'
  );

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    environment.webPush = {
      vapidKey: undefined,
      serviceWorkerPath: '/assets/firebase-messaging-sw.js',
    };

    requestPermission.mockResolvedValue('granted');

    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: {
        permission: 'default',
        requestPermission,
      },
    });

    TestBed.configureTestingModule({
      providers: [
        PushNotificationDeviceService,
        {
          provide: Functions,
          useValue: {},
        },
        {
          provide: AuthSessionService,
          useValue: {
            readyUid$: of('test-user'),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
      ],
    });
  });

  afterEach(() => {
    environment.webPush = originalWebPush;
    localStorage.clear();

    if (originalNotification) {
      Object.defineProperty(
        globalThis,
        'Notification',
        originalNotification
      );
    } else {
      Reflect.deleteProperty(globalThis, 'Notification');
    }

    TestBed.resetTestingModule();
  });

  it('VAPID ausente nunca abre o prompt de permissão', async () => {
    const service = TestBed.inject(PushNotificationDeviceService);

    const state = await firstValueFrom(service.activate$());

    expect(state).toBe('unconfigured');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('startup nunca pede permissão mesmo com opt-in persistido', () => {
    environment.webPush = {
      vapidKey: `B${'a'.repeat(86)}`,
      serviceWorkerPath: '/assets/firebase-messaging-sw.js',
    };
    localStorage.setItem(
      'entretenimento.push.opt-in-uid.v1',
      'test-user'
    );

    const service = TestBed.inject(PushNotificationDeviceService);
    service.start();

    expect(requestPermission).not.toHaveBeenCalled();
  });
});
