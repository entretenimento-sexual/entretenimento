import { clearPendingLogout, savePendingLogout } from '@core/firebase/pending-logout';
import { IDBFactory } from 'fake-indexeddb';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, defaultIfEmpty, firstValueFrom, map, of, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { PUSH_NOTIFICATION_SDK, PushNotificationDeviceService } from './push-notification-device.service';
import { updatePushDeliveryBinding } from './push-delivery-binding';
import { environment } from 'src/environments/environment';

const fcm = {
  getToken: vi.fn(),
  deleteToken: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  getMessaging: () => ({}),
  isSupported: () => Promise.resolve(true),
};

describe('PushNotificationDeviceService', () => {
  const optInStorageKey = 'entretenimento.push.opt-in-uid.v1';
  const requestPermission = vi.fn<() => Promise<NotificationPermission>>();
  const originalWebPush = environment.webPush;
  const originalNotification = Object.getOwnPropertyDescriptor(
    globalThis,
    'Notification'
  );
  const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  let user: { uid: string };
  let uid$: BehaviorSubject<string | null>;

  function configurePush(permission: NotificationPermission): void {
    vi.stubGlobal('isSecureContext', true);
    environment.webPush = { ...environment.webPush, vapidKey: `B${'a'.repeat(86)}` };
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: { permission, requestPermission },
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: vi.fn().mockResolvedValue({}),
        getRegistration: vi.fn().mockResolvedValue(undefined),
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('indexedDB', new IDBFactory());
    localStorage.clear();
    user = { uid: 'test-user' };
    uid$ = new BehaviorSubject<string | null>(user.uid);
    fcm.getToken.mockResolvedValue('a-valid-test-fcm-registration-token');
    fcm.deleteToken.mockResolvedValue(true);
    fcm.register.mockResolvedValue({ data: { ok: true } });
    fcm.unregister.mockResolvedValue({ data: { ok: true } });
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
          provide: PUSH_NOTIFICATION_SDK,
          useValue: fcm,
        },
        {
          provide: AuthSessionService,
          useValue: {
            readyUid$: uid$,
            authUser$: uid$.pipe(map(() => user)),
            get currentAuthUser() { return user; },
            isTerminatingSnapshot: false,
            terminationVersionSnapshot: 0,
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
    vi.unstubAllGlobals();
    environment.webPush = originalWebPush;
    localStorage.clear();
    clearPendingLogout('test-user');

    if (originalNotification) {
      Object.defineProperty(
        globalThis,
        'Notification',
        originalNotification
      );
    } else {
      Reflect.deleteProperty(globalThis, 'Notification');
    }
    if (originalServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
    } else {
      Reflect.deleteProperty(navigator, 'serviceWorker');
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

  it('descarta a permissão aberta por outra sessão sem registrar token ou alterar o opt-in', async () => {
    configurePush('default');
    let grant!: (permission: NotificationPermission) => void;
    requestPermission.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
    const service = TestBed.inject(PushNotificationDeviceService);
    const result = firstValueFrom(service.activate$().pipe(defaultIfEmpty('cancelled')));
    await vi.waitFor(() => expect(requestPermission).toHaveBeenCalledOnce());

    user = { uid: 'new-account' };
    uid$.next(user.uid);
    localStorage.setItem(optInStorageKey, user.uid);
    grant('granted');

    expect(await result).toBe('cancelled');
    expect(fcm.getToken).not.toHaveBeenCalled();
    expect(fcm.register).not.toHaveBeenCalled();
    expect(localStorage.getItem(optInStorageKey)).toBe(user.uid);
  });

  it('cancela o registro pendente no backend mesmo com ativação em andamento', async () => {
    configurePush('granted');
    let registered!: (value: { data: { ok: true } }) => void;
    fcm.register.mockImplementationOnce(() => new Promise(resolve => { registered = resolve; }));
    const service = TestBed.inject(PushNotificationDeviceService);
    const activation = firstValueFrom(service.activate$().pipe(defaultIfEmpty('cancelled')));
    await vi.waitFor(() => expect(fcm.register).toHaveBeenCalledOnce());
    const request = fcm.register.mock.calls[0][0];

    expect(await firstValueFrom(service.deactivate$())).toBe('inactive');
    expect(fcm.unregister).toHaveBeenCalledWith({
      installationId: request.installationId,
      expectedUid: 'test-user',
      cancelledRegistrationIds: [request.registrationId],
    });
    expect(fcm.deleteToken).toHaveBeenCalledOnce();
    registered({ data: { ok: true } });

    expect(await activation).toBe('cancelled');
    expect(await firstValueFrom(service.state$)).toBe('inactive');
    expect(localStorage.getItem(optInStorageKey)).toBeNull();
  });

  it('desvincula no backend antes de o FCM concluir uma criação local que perdeu a sessão', async () => {
    configurePush('granted');
    let issueToken!: (token: string) => void;
    fcm.getToken.mockImplementationOnce(() => new Promise(resolve => { issueToken = resolve; }));
    const service = TestBed.inject(PushNotificationDeviceService);
    const activation = firstValueFrom(service.activate$().pipe(defaultIfEmpty('cancelled')));
    await vi.waitFor(() => expect(fcm.getToken).toHaveBeenCalledOnce());

    const deactivation = firstValueFrom(service.deactivate$());
    expect(fcm.unregister).toHaveBeenCalledOnce();
    expect(fcm.deleteToken).not.toHaveBeenCalled();
    issueToken('a-valid-test-fcm-registration-token');

    expect(await deactivation).toBe('inactive');
    expect(await activation).toBe('cancelled');
    expect(fcm.deleteToken).toHaveBeenCalledOnce();
    expect(fcm.register).not.toHaveBeenCalled();
  });

  it('espera a limpeza antes de restaurar uma saída recusada e não repete o prompt', async () => {
    configurePush('granted');
    let remove!: (result: { data: { ok: true } }) => void;
    fcm.unregister.mockImplementationOnce(() => new Promise(resolve => { remove = resolve; }));
    const service = TestBed.inject(PushNotificationDeviceService);
    expect(await firstValueFrom(service.activate$())).toBe('active');

    const deactivation = firstValueFrom(service.deactivate$());
    uid$.next(null);
    const restoration = firstValueFrom(service.activate$('restore'));
    expect(fcm.register).toHaveBeenCalledOnce();
    remove({ data: { ok: true } });

    expect(await deactivation).toBe('inactive');
    expect(fcm.register).toHaveBeenCalledOnce();
    uid$.next(user.uid);
    expect(await restoration).toBe('active');
    expect(fcm.register).toHaveBeenCalledTimes(2);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('impede a reativação durante a retomada da saída no bootstrap', async () => {
    configurePush('granted');
    const service = TestBed.inject(PushNotificationDeviceService);
    expect(await firstValueFrom(service.activate$())).toBe('active');
    expect(fcm.register).toHaveBeenCalledOnce();

    savePendingLogout('test-user');
    service.start();
    await vi.waitFor(async () => {
      expect(await updatePushDeliveryBinding((current) => current)).toBeUndefined();
    });
    expect(fcm.register).toHaveBeenCalledOnce();
    expect(localStorage.getItem(optInStorageKey)).toBeNull();
  });

  it('revoga o vínculo local mesmo se o servidor e o FCM falharem offline', async () => {
    configurePush('granted');
    const service = TestBed.inject(PushNotificationDeviceService);
    expect(await firstValueFrom(service.activate$())).toBe('active');
    expect(fcm.register.mock.calls[0][0].deliveryBindingId).toBeTruthy();
    const subscription = { unsubscribe: vi.fn().mockResolvedValue(true) };
    vi.mocked(navigator.serviceWorker.getRegistration).mockResolvedValue({
      active: { scriptURL: new URL('/assets/firebase-messaging-sw.js', location.href).href },
      pushManager: { getSubscription: async () => subscription },
      getNotifications: async () => [],
    } as unknown as ServiceWorkerRegistration);
    fcm.unregister.mockRejectedValueOnce(new Error('offline'));
    fcm.deleteToken.mockRejectedValueOnce(new Error('offline'));

    expect(await firstValueFrom(service.deactivate$())).toBe('inactive');
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(await updatePushDeliveryBinding((current) => current)).toBeUndefined();

    expect(await firstValueFrom(service.activate$())).toBe('active');
    expect(fcm.register.mock.calls[1][0].deliveryBindingId)
      .not.toBe(fcm.register.mock.calls[0][0].deliveryBindingId);
  });

  it('desativa o token local ao assumir outra conta sem reaproveitar o opt-in anterior', async () => {
    configurePush('granted');
    const service = TestBed.inject(PushNotificationDeviceService);
    service.start();
    expect(await firstValueFrom(service.activate$())).toBe('active');
    expect(localStorage.getItem(optInStorageKey)).toBe('test-user');

    user = { uid: 'new-account' };
    uid$.next(user.uid);

    await vi.waitFor(() => expect(fcm.deleteToken).toHaveBeenCalledOnce());
    expect(await firstValueFrom(service.state$)).toBe('inactive');
    expect(localStorage.getItem(optInStorageKey)).toBeNull();
    expect(fcm.register).toHaveBeenCalledOnce();
    expect(await updatePushDeliveryBinding((current) => current)).toBeUndefined();
  });
});
