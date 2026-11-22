import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { firstValueFrom, of, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { PushNotificationDeviceService } from 'src/app/core/services/notifications/push-notification-device.service';
import { environment } from 'src/environments/environment';

describe('PushNotificationDeviceService', () => {
  const optInStorageKey = 'entretenimento.push.opt-in-uid.v1';
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
          provide: ApplicationErrorService,
          useValue: {
            report: vi.fn(),
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

  it('desativa Web Push sem inicializar o FCM quando não há chave VAPID', async () => {
    const originalServiceWorker = Object.getOwnPropertyDescriptor(
      navigator,
      'serviceWorker'
    );
    localStorage.setItem(optInStorageKey, 'test-user');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: vi.fn() },
    });
    try {
      const service = TestBed.inject(PushNotificationDeviceService);
      const errors = TestBed.inject(ApplicationErrorService);
      const supportCheck = vi.spyOn(
        service as unknown as { firebaseMessagingSupported$(): Observable<boolean> },
        'firebaseMessagingSupported$'
      ).mockReturnValue(of(true));

      expect(await firstValueFrom(service.deactivate$())).toBe('inactive');
      expect(localStorage.getItem(optInStorageKey)).toBeNull();
      expect(supportCheck).not.toHaveBeenCalled();
      expect(errors.report).not.toHaveBeenCalled();
    } finally {
      if (originalServiceWorker) {
        Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
      } else {
        Reflect.deleteProperty(navigator, 'serviceWorker');
      }
    }
  });

  it('startup nunca pede permissão mesmo com opt-in persistido', () => {
    environment.webPush = {
      vapidKey: `B${'a'.repeat(86)}`,
      serviceWorkerPath: '/assets/firebase-messaging-sw.js',
    };
    localStorage.setItem(optInStorageKey, 'test-user');

    const service = TestBed.inject(PushNotificationDeviceService);
    service.start();

    expect(requestPermission).not.toHaveBeenCalled();
  });
});
