// src/app/core/services/notifications/push-notification-device.service.ts
// -----------------------------------------------------------------------------
// PUSH NOTIFICATION DEVICE SERVICE
// -----------------------------------------------------------------------------
// Lifecycle Web Push/FCM do navegador.
//
// Princípios:
// - API pública reativa por Observable;
// - nunca solicita permissão fora de uma ação explícita do usuário;
// - sincroniza no bootstrap apenas instalações que já possuem opt-in local;
// - installation id aleatória e persistente, sem fingerprint de hardware;
// - VAPID ausente falha fechado antes de qualquer prompt;
// - erros técnicos engolidos/fallbackados passam por ApplicationErrorService;
// - falhas públicas sobem para a UI, que usa a mesma entrada canônica.
// -----------------------------------------------------------------------------

import { Injectable, InjectionToken, OnDestroy, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { getApp } from 'firebase/app';
import type { User } from 'firebase/auth';
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  type Messaging,
} from 'firebase/messaging';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subscription,
  combineLatest,
  defer,
  forkJoin,
  from,
  of,
  throwError,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  endWith,
  filter,
  finalize,
  ignoreElements,
  map,
  shareReplay,
  switchMap,
  take,
  takeUntil,
  timeout,
} from 'rxjs/operators';

import { environment } from 'src/environments/environment';
import { readPendingLogout } from '@core/firebase/pending-logout';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  createPushInstallationId,
  DEFAULT_PUSH_SERVICE_WORKER_PATH,
  isValidPushInstallationId,
  MIN_PUSH_FCM_TOKEN_LENGTH,
  normalizePushVapidKey,
} from 'src/app/core/services/notifications/push-notification-device.policy';

import { createPushDeliveryBinding, updatePushDeliveryBinding } from './push-delivery-binding';

export type PushNotificationDeviceState =
  | 'active'
  | 'inactive'
  | 'blocked'
  | 'unsupported'
  | 'unconfigured'
  | 'error';

export interface PushNotificationDeviceVm {
  state: PushNotificationDeviceState;
  busy: boolean;
}

interface PushDeviceRegistrationRequest {
  expectedUid: string;
  registrationId: string;
  deliveryBindingId: string;
  token: string;
  platform: 'web';
  installationId: string;
}

interface PushDeviceUnregistrationRequest {
  expectedUid: string;
  installationId: string;
  cancelledRegistrationIds: string[];
}

interface PushDeviceCallableResponse {
  ok?: unknown;
}

export const PUSH_NOTIFICATION_SDK = new InjectionToken('PushNotificationSdk', {
  factory: () => {
    const functions = inject(Functions);
    return {
      isSupported,
      getMessaging: () => getMessaging(getApp()),
      getToken,
      deleteToken,
      register: (request: PushDeviceRegistrationRequest) =>
        httpsCallable<PushDeviceRegistrationRequest, PushDeviceCallableResponse>(
          functions, 'registerPushDevice'
        )(request),
      unregister: (request: PushDeviceUnregistrationRequest) =>
        httpsCallable<PushDeviceUnregistrationRequest, PushDeviceCallableResponse>(
          functions, 'unregisterPushDevice'
        )(request),
    };
  },
});

interface PushSession {
  user: User;
  terminationVersion: number;
  optOutVersion: number;
}

const PUSH_OPT_IN_UID_STORAGE_KEY = 'entretenimento.push.opt-in-uid.v1';
const PUSH_INSTALLATION_STORAGE_KEY =
  'entretenimento.push.installation-id.v2';
const PUSH_CLEANUP_TIMEOUT_MS = 10_000;

@Injectable({ providedIn: 'root' })
export class PushNotificationDeviceService implements OnDestroy {
  private readonly sdk = inject(PUSH_NOTIFICATION_SDK);
  private readonly session = inject(AuthSessionService);
  private readonly applicationError = inject(ApplicationErrorService);

  private readonly stateSubject =
    new BehaviorSubject<PushNotificationDeviceState>('inactive');
  private readonly busySubject = new BehaviorSubject(false);
  private startupSubscription: Subscription | null = null;
  private optOutVersion = 0;
  private deactivation: { user: User; cleanup$: Observable<PushNotificationDeviceState> } | null = null;
  private readonly registrationsInProgress = new Map<string, string>();
  private localMessagingWork: Promise<unknown> = Promise.resolve();
  private messagingWithWorker: Messaging | null = null;

  readonly state$: Observable<PushNotificationDeviceState> =
    this.stateSubject.asObservable().pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /** Snapshot read-only para rollback do logout, antes da queda reativa de UID. */
  get currentStateSnapshot(): PushNotificationDeviceState {
    return this.stateSubject.value;
  }

  readonly busy$: Observable<boolean> = this.busySubject.asObservable().pipe(
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly vm$: Observable<PushNotificationDeviceVm> = combineLatest([
    this.state$,
    this.busy$,
  ]).pipe(
    map(([state, busy]) => ({ state, busy })),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  start(): void {
    if (this.startupSubscription) return;

    let previousUid: string | null = null;
    this.startupSubscription = this.session.authUser$.pipe(
      map(() => this.session.currentAuthUser),
      distinctUntilChanged(),
      switchMap((user) => {
        const outgoingUid = previousUid;
        const incomingUid = user && readPendingLogout() !== user.uid ? user.uid : null;
        previousUid = incomingUid;
        this.setState('inactive');

        return this.clearOptInAfterAccountChange$(outgoingUid, incomingUid).pipe(
          switchMap(() => {
            const scope = user && this.captureSession(user.uid);
            if (!scope || this.deactivation?.user === user) return EMPTY;
            return this.session.readyUid$.pipe(
              filter((uid) => uid === scope.user.uid),
              take(1),
              switchMap(() => this.synchronizeExistingOptInForUid$(scope)),
              catchError((error) => {
                if (!this.isCurrent(scope)) return EMPTY;
                this.reportError(error, 'startupSync');
                return of(this.setState('error'));
              })
            );
          })
        );
      })
    ).subscribe();
  }

  refresh$(): Observable<PushNotificationDeviceState> {
    return this.runBusy$(() =>
      this.session.readyUid$.pipe(
        take(1),
        switchMap((uid) => {
          const safeUid = String(uid ?? '').trim();

          if (!safeUid) {
            return of(this.setState('inactive'));
          }

          const scope = this.captureSession(safeUid);
          return scope ? this.synchronizeExistingOptInForUid$(scope) : EMPTY;
        })
      )
    ).pipe(
      catchError((error) =>
        this.failOperation(error)
      )
    );
  }

  activate$(mode: 'request-permission' | 'restore' = 'request-permission'): Observable<PushNotificationDeviceState> {
    const activation$ = this.runBusy$(() =>
      defer(() => {
        const vapidKey = this.resolveVapidKey();

        if (!vapidKey) {
          return of(this.setState('unconfigured'));
        }

        if (!this.hasBrowserPushApis()) {
          return of(this.setState('unsupported'));
        }

        const scope = this.captureSession();
        if (!scope) return EMPTY;
        return this.firebaseMessagingSupported$().pipe(
          switchMap((supported) => {
            if (!this.isCurrent(scope)) return EMPTY;
            if (!supported) {
              return of(this.setState('unsupported'));
            }

            // Validamos a capacidade de persistência antes do prompt, mas só
            // criamos a installation id depois da permissão concedida. Assim,
            // quem recusa Web Push não recebe um identificador persistente.
            this.requireLocalStorage();

            const currentPermission = this.notificationPermission();

            if (currentPermission === 'denied') {
              this.removeOptInSafely(scope.user.uid);
              return of(this.setState('blocked'));
            }

            const permission$ =
              currentPermission === 'default' && mode === 'request-permission'
                ? this.requestPermission$()
                : of(currentPermission);

            return permission$.pipe(
              switchMap((permission) => {
                if (!this.isCurrent(scope)) return EMPTY;
                if (permission !== 'granted') {
                  this.removeOptInSafely(scope.user.uid);
                  return of(
                    this.setState(
                      permission === 'denied' ? 'blocked' : 'inactive'
                    )
                  );
                }

                return this.session.readyUid$.pipe(
                  filter((uid) => uid === scope.user.uid),
                  take(1),
                  timeout({ first: PUSH_CLEANUP_TIMEOUT_MS }),
                  switchMap(() => this.registerForUid$(scope, vapidKey, true))
                );
              })
            );
          }),
          takeUntil(this.session.authUser$.pipe(filter(() => !this.isCurrent(scope)))),
          catchError((error) => this.isCurrent(scope) ? throwError(() => error) : EMPTY)
        );
      })
    ).pipe(
      catchError((error) => this.failOperation(error))
    );
    if (mode !== 'restore') return activation$;

    return defer(() => {
      const scope = this.captureSession();
      if (!scope) return EMPTY;
      const cleanup$ = this.deactivation?.cleanup$ ?? EMPTY;
      return cleanup$.pipe(
        ignoreElements(),
        catchError(() => EMPTY),
        endWith(undefined),
        switchMap(() => this.busy$.pipe(filter((busy) => !busy), take(1))),
        switchMap(() => this.isCurrent(scope) ? activation$ : EMPTY),
        takeUntil(this.session.authUser$.pipe(filter(() => !this.isCurrent(scope))))
      );
    }).pipe(shareReplay({ bufferSize: 1, refCount: false }));
  }

  deactivate$(): Observable<PushNotificationDeviceState> {
    return defer(() => {
      const user = this.session.currentAuthUser;
      if (!user) return of(this.setState('inactive'));
      if (this.deactivation?.user === user) return this.deactivation.cleanup$;
      const uid = user.uid;
      const version = ++this.optOutVersion;
      const cleanup$ = defer(() => {
        this.removeOptInSafely(uid);
        const delivery = this.revokeDelivery$((ownerUid) => ownerUid === uid);
        const installationId = this.readInstallationId();
        const cancelledRegistrationIds = Array.from(this.registrationsInProgress)
          .filter(([, owner]) => owner === uid)
          .map(([registrationId]) => registrationId);

        return forkJoin({
          delivery,
          backend: installationId
            ? this.unregisterBackend$({ installationId, expectedUid: uid, cancelledRegistrationIds }).pipe(
                timeout({ first: PUSH_CLEANUP_TIMEOUT_MS }),
                map(() => true),
                catchError((error) => {
                  this.reportError(error, 'unregisterBackend');
                  return of(false);
                })
              )
            : of(true),
          localToken: this.deleteLocalMessagingToken$(uid).pipe(
            timeout({ first: PUSH_CLEANUP_TIMEOUT_MS }),
            map(() => true),
            catchError((error) => {
              this.reportError(error, 'deleteLocalToken');
              return of(false);
            })
          ),
        }).pipe(
          switchMap(({ delivery, backend, localToken }) => {
            if (this.session.currentAuthUser !== user || version !== this.optOutVersion) {
              return EMPTY;
            }
            if (!delivery && !backend && !localToken) {
              return throwError(
                () =>
                  new Error(
                    'Não foi possível remover o registro Web Push local ou remoto.'
                  )
              );
            }

            return of(this.setState('inactive'));
          })
        );
      }).pipe(
        catchError((error) => this.session.currentAuthUser === user
          ? this.failOperation(error)
          : EMPTY),
        finalize(() => {
          if (this.deactivation?.cleanup$ === cleanup$) {
            this.deactivation = null;
            this.busySubject.next(false);
          }
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
      this.deactivation = { user, cleanup$ };
      this.busySubject.next(true);
      return cleanup$;
    });
  }

  ngOnDestroy(): void {
    this.startupSubscription?.unsubscribe();
    this.startupSubscription = null;
  }

  private synchronizeExistingOptInForUid$(
    scope: PushSession
  ): Observable<PushNotificationDeviceState> {
    return defer(() => {
      const vapidKey = this.resolveVapidKey();

      if (!vapidKey) {
        return of(this.setState('unconfigured'));
      }

      if (!this.hasBrowserPushApis()) {
        return of(this.setState('unsupported'));
      }

      const permission = this.notificationPermission();

      if (permission === 'denied') {
        return of(this.setState('blocked'));
      }

      if (!this.hasPersistedOptInForUid(scope.user.uid)) {
        return of(this.setState('inactive'));
      }

      // Startup nunca chama requestPermission(). Se a permissão foi resetada
      // pelo navegador, a próxima decisão fica novamente a cargo do usuário.
      if (permission !== 'granted') {
        return of(this.setState('inactive'));
      }

      return this.firebaseMessagingSupported$().pipe(
        switchMap((supported) => {
          if (!this.isCurrent(scope)) return EMPTY;
          if (!supported) {
            return of(this.setState('unsupported'));
          }

          return this.registerForUid$(scope, vapidKey);
        })
      );
    });
  }

  private registerForUid$(
    scope: PushSession,
    vapidKey: string,
    persistOptIn = false
  ): Observable<PushNotificationDeviceState> {
    return defer(() => {
      if (!this.isCurrent(scope)) return EMPTY;
      const installationId = this.ensureInstallationId();

      return from(updatePushDeliveryBinding((current) => {
        if (!this.isCurrent(scope) || (!persistOptIn && !this.hasPersistedOptInForUid(scope.user.uid))) {
          return undefined;
        }
        return current?.uid === scope.user.uid ? current : createPushDeliveryBinding(scope.user.uid);
      })).pipe(
        switchMap((binding) => {
          if (!binding || !this.isCurrent(scope)) return EMPTY;
          return this.withLocalMessaging$(async () => {
            if (!this.isCurrent(scope)) return null;
            const registration = await navigator.serviceWorker.register(this.buildServiceWorkerUrl(), {
              updateViaCache: 'none',
            });
            if (!this.isCurrent(scope)) return null;
            const messaging = this.sdk.getMessaging();
            const token = await this.sdk.getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
            this.messagingWithWorker = messaging;
            return token;
          }).pipe(map((token) => ({ binding, token: String(token ?? '').trim() })));
        }),
        switchMap(({ binding, token }) => {
          if (!this.isCurrent(scope)) return EMPTY;
          if (token.length < MIN_PUSH_FCM_TOKEN_LENGTH) {
            return throwError(
              () => new Error('FCM não retornou um token Web Push válido.')
            );
          }

          const registrationId = createPushInstallationId(globalThis.crypto);
          this.registrationsInProgress.set(registrationId, scope.user.uid);
          return from(Promise.resolve().then(() => (this.isCurrent(scope)
            ? this.sdk.register({
              token, platform: 'web', installationId, registrationId,
              deliveryBindingId: binding.id, expectedUid: scope.user.uid,
            })
            : null)
          ).finally(() => this.registrationsInProgress.delete(registrationId)));
        }),
        switchMap((result) => {
          if (!result || !this.isCurrent(scope)) return EMPTY;
          if (result.data?.ok !== true) {
            throw new Error('Registro do dispositivo Web Push não confirmado.');
          }

          if (persistOptIn) this.persistOptInForUid(scope.user.uid);
          return of(this.setState('active'));
        })
      );
    }).pipe(
      catchError((error) => this.isCurrent(scope) ? throwError(() => error) : EMPTY)
    );
  }

  private unregisterBackend$(request: PushDeviceUnregistrationRequest): Observable<void> {
    return defer(() => from(this.sdk.unregister(request))).pipe(
      map((result) => {
        if (result.data?.ok !== true) {
          throw new Error('Remoção do dispositivo Web Push não confirmada.');
        }
      })
    );
  }

  private deleteLocalMessagingToken$(uid: string): Observable<void> {
    // Sem VAPID este ambiente não emite tokens. deleteToken pode tentar
    // registrar o worker padrão do FCM quando a instância não tem worker.
    if (!this.resolveVapidKey() || !this.hasBrowserPushApis()) {
      return of(undefined);
    }

    return this.withLocalMessaging$(async () => {
      const optedInUid = this.requireLocalStorage().getItem(PUSH_OPT_IN_UID_STORAGE_KEY);
      if (optedInUid && optedInUid !== uid) return;
      const path = this.resolveServiceWorkerPath();
      const registration = await navigator.serviceWorker.getRegistration(path);
      if (registration?.active && new URL(registration.active.scriptURL).pathname === path) {
        const subscription = await registration.pushManager.getSubscription();
        const currentOwner = this.requireLocalStorage().getItem(PUSH_OPT_IN_UID_STORAGE_KEY);
        if (currentOwner && currentOwner !== uid) return;
        if (subscription && !await subscription.unsubscribe()) {
          throw new Error('O navegador não confirmou a remoção do Web Push.');
        }
      }

      // O SDK revoga o token no FCM, o que pode aguardar a reconexão. A
      // assinatura do navegador é removida primeiro, de forma independente.
      if (this.messagingWithWorker) {
        const removed = await this.sdk.deleteToken(this.messagingWithWorker);
        if (!removed) throw new Error('O navegador não confirmou a remoção do token Web Push.');
        this.messagingWithWorker = null;
      }
    });
  }

  private clearOptInAfterAccountChange$(outgoingUid: string | null, incomingUid: string | null): Observable<void> {
    return defer(() => {
      if (!this.hasBrowserPushApis()) return of(undefined);
      const ownerUid = this.readStorageSafely(PUSH_OPT_IN_UID_STORAGE_KEY);
      const inactiveUid = ownerUid ?? outgoingUid;
      const revoke = this.revokeDelivery$((uid) => uid !== incomingUid);
      if (!inactiveUid || inactiveUid === incomingUid) return revoke.pipe(map(() => undefined));

      this.removeOptInSafely(inactiveUid);
      return forkJoin([
        revoke,
        this.deleteLocalMessagingToken$(inactiveUid).pipe(timeout({ first: PUSH_CLEANUP_TIMEOUT_MS })),
      ]).pipe(map(() => undefined));
    }).pipe(
      catchError((error) => {
        this.reportError(error, 'clearOptInAfterAccountChange');
        return of(undefined);
      })
    );
  }

  private revokeDelivery$(matches: (uid: string) => boolean): Observable<boolean> {
    if (!this.hasBrowserPushApis() || typeof indexedDB === 'undefined') return of(false);

    return defer(() => {
      let retiredId: string | undefined;
      return from(updatePushDeliveryBinding((current) => {
        if (!current || !matches(current.uid)) return undefined;
        retiredId = current.id;
        return null;
      })).pipe(
        switchMap(() => retiredId
          ? from(this.closeDisplayedPushNotifications(retiredId)).pipe(map(() => true))
          : of(true))
      );
    }).pipe(
      timeout({ first: PUSH_CLEANUP_TIMEOUT_MS }),
      catchError((error) => {
        this.reportError(error, 'revokeDelivery');
        return of(false);
      })
    );
  }

  private async closeDisplayedPushNotifications(bindingId: string): Promise<void> {
    const path = this.resolveServiceWorkerPath();
    const registration = await navigator.serviceWorker.getRegistration(path);
    if (registration?.active && new URL(registration.active.scriptURL).pathname === path) {
      for (const notification of await registration.getNotifications()) {
        if (notification.data?.webPushBinding === bindingId || notification.data?.FCM_MSG) {
          notification.close();
        }
      }
    }
  }

  private withLocalMessaging$<T>(work: () => Promise<T>): Observable<T> {
    return defer(() => {
      // As Promises do SDK continuam executando após cancelar uma inscrição.
      // A próxima mutação local só começa quando a anterior realmente termina.
      const task = this.localMessagingWork.then(work);
      this.localMessagingWork = task.catch(() => undefined);
      return from(task);
    });
  }

  private captureSession(uid = this.session.currentAuthUser?.uid): PushSession | null {
    const user = this.session.currentAuthUser;
    if (!user || user.uid !== uid || this.session.isTerminatingSnapshot || readPendingLogout() === uid) return null;
    return { user, terminationVersion: this.session.terminationVersionSnapshot, optOutVersion: this.optOutVersion };
  }

  private isCurrent(scope: PushSession): boolean {
    return this.session.currentAuthUser === scope.user &&
      !this.session.isTerminatingSnapshot &&
      this.session.terminationVersionSnapshot === scope.terminationVersion &&
      this.optOutVersion === scope.optOutVersion;
  }

  private firebaseMessagingSupported$(): Observable<boolean> {
    return defer(() => from(this.sdk.isSupported())).pipe(
      catchError((error) => {
        this.reportError(error, 'isSupported');
        return of(false);
      })
    );
  }

  private requestPermission$(): Observable<NotificationPermission> {
    return defer(() => from(Notification.requestPermission()));
  }

  private notificationPermission(): NotificationPermission {
    return Notification.permission;
  }

  private hasBrowserPushApis(): boolean {
    if (
      typeof window === 'undefined' ||
      typeof navigator === 'undefined' ||
      typeof Notification === 'undefined'
    ) {
      return false;
    }

    if (
      typeof globalThis.isSecureContext === 'boolean' &&
      !globalThis.isSecureContext
    ) {
      return false;
    }

    return 'serviceWorker' in navigator;
  }

  private resolveVapidKey(): string | null {
    return normalizePushVapidKey(environment.webPush?.vapidKey);
  }

  private resolveServiceWorkerPath(): string {
    const configured = String(
      environment.webPush?.serviceWorkerPath ?? ''
    ).trim();

    if (!configured || !configured.startsWith('/')) {
      return DEFAULT_PUSH_SERVICE_WORKER_PATH;
    }

    return configured;
  }

  private buildServiceWorkerUrl(): string {
    const config = environment.firebase;
    const params = new URLSearchParams({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
    });

    return `${this.resolveServiceWorkerPath()}?${params.toString()}`;
  }

  private hasPersistedOptInForUid(uid: string): boolean {
    const storage = this.requireLocalStorage();
    return storage.getItem(PUSH_OPT_IN_UID_STORAGE_KEY) === uid;
  }

  private persistOptInForUid(uid: string): void {
    const storage = this.requireLocalStorage();
    storage.setItem(PUSH_OPT_IN_UID_STORAGE_KEY, uid);
  }

  private removeOptInSafely(uid: string): void {
    try {
      const storage = this.requireLocalStorage();
      if (storage.getItem(PUSH_OPT_IN_UID_STORAGE_KEY) === uid) {
        storage.removeItem(PUSH_OPT_IN_UID_STORAGE_KEY);
      }
    } catch (error) {
      this.reportError(error, 'persistOptOut');
    }
  }

  private readInstallationId(): string | null {
    const existing = (this.readStorageSafely(PUSH_INSTALLATION_STORAGE_KEY) ?? '').trim();
    return isValidPushInstallationId(existing) ? existing : null;
  }

  private readStorageSafely(key: string): string | null {
    try {
      return this.requireLocalStorage().getItem(key);
    } catch (error) {
      this.reportError(error, 'readPushStorage');
      return null;
    }
  }

  private ensureInstallationId(): string {
    const storage = this.requireLocalStorage();
    const existing = String(
      storage.getItem(PUSH_INSTALLATION_STORAGE_KEY) ?? ''
    ).trim();

    if (isValidPushInstallationId(existing)) {
      return existing;
    }

    const cryptoApi = globalThis.crypto;

    if (!cryptoApi) {
      throw new Error(
        'Criptografia segura indisponível para identificar a instalação.'
      );
    }

    const installationId = createPushInstallationId(cryptoApi);
    storage.setItem(PUSH_INSTALLATION_STORAGE_KEY, installationId);
    return installationId;
  }

  private requireLocalStorage(): Storage {
    if (typeof localStorage === 'undefined') {
      throw new Error('Armazenamento local indisponível para Web Push.');
    }

    return localStorage;
  }

  private runBusy$(
    sourceFactory: () => Observable<PushNotificationDeviceState>
  ): Observable<PushNotificationDeviceState> {
    return defer(() => {
      if (this.busySubject.value) return EMPTY;

      const version = this.optOutVersion;
      this.busySubject.next(true);

      return sourceFactory().pipe(
        finalize(() => {
          if (version === this.optOutVersion) this.busySubject.next(false);
        })
      );
    });
  }

  private setState(
    state: PushNotificationDeviceState
  ): PushNotificationDeviceState {
    this.stateSubject.next(state);
    return state;
  }

  private failOperation(error: unknown): Observable<never> {
    this.setState('error');
    return throwError(() => error);
  }

  private reportError(
    error: unknown,
    operation: string,
    extra: Record<string, unknown> = {}
  ): void {
    this.applicationError.report(error, {
      feature: 'notifications.push-device',
      operation,
      fallbackMessage: 'Não foi possível sincronizar as notificações deste dispositivo.',
      notification: 'none',
      metadata: {
        scope: 'PushNotificationDeviceService',
        environment: environment.env,
        state: this.stateSubject.value,
        ...extra,
      },
    });
  }
}
