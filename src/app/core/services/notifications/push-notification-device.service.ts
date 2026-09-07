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
// - erros técnicos seguem para GlobalErrorHandlerService;
// - mensagens amigáveis ficam a cargo da camada de UI/ErrorNotificationService.
// -----------------------------------------------------------------------------

import { Injectable, OnDestroy, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { getApp } from 'firebase/app';
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  type Messaging,
} from 'firebase/messaging';
import {
  BehaviorSubject,
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
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { environment } from 'src/environments/environment';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  createPushInstallationId,
  DEFAULT_PUSH_SERVICE_WORKER_PATH,
  isValidPushInstallationId,
  MIN_PUSH_FCM_TOKEN_LENGTH,
  normalizePushVapidKey,
} from 'src/app/core/services/notifications/push-notification-device.policy';

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
  token: string;
  platform: 'web';
  installationId: string;
}

interface PushDeviceUnregistrationRequest {
  installationId: string;
}

interface PushDeviceCallableResponse {
  ok?: unknown;
}

interface PushNotificationReportableError extends Error {
  context?: string;
  operation?: string;
  extra?: Record<string, unknown>;
  original?: unknown;
  skipUserNotification?: boolean;
}

const PUSH_OPT_IN_UID_STORAGE_KEY = 'entretenimento.push.opt-in-uid.v1';
const PUSH_INSTALLATION_STORAGE_KEY =
  'entretenimento.push.installation-id.v2';

@Injectable({ providedIn: 'root' })
export class PushNotificationDeviceService implements OnDestroy {
  private readonly functions = inject(Functions);
  private readonly session = inject(AuthSessionService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly stateSubject =
    new BehaviorSubject<PushNotificationDeviceState>('inactive');
  private readonly busySubject = new BehaviorSubject(false);
  private startupSubscription: Subscription | null = null;
  private sessionForcedOptOut = false;

  readonly state$: Observable<PushNotificationDeviceState> =
    this.stateSubject.asObservable().pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

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

    this.startupSubscription = this.session.readyUid$
      .pipe(
        distinctUntilChanged(),
        switchMap((uid) => {
          const safeUid = String(uid ?? '').trim();

          if (!safeUid) {
            return of(this.setState('inactive'));
          }

          return this.synchronizeExistingOptInForUid$(safeUid).pipe(
            catchError((error) => {
              this.setState('error');
              this.reportError(error, 'startupSync');
              return of<PushNotificationDeviceState>('error');
            })
          );
        })
      )
      .subscribe();
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

          return this.synchronizeExistingOptInForUid$(safeUid);
        })
      )
    ).pipe(
      catchError((error) =>
        this.failOperation(error, 'refresh')
      )
    );
  }

  activate$(): Observable<PushNotificationDeviceState> {
    return this.runBusy$(() =>
      defer(() => {
        const vapidKey = this.resolveVapidKey();

        if (!vapidKey) {
          return of(this.setState('unconfigured'));
        }

        if (!this.hasBrowserPushApis()) {
          return of(this.setState('unsupported'));
        }

        return this.firebaseMessagingSupported$().pipe(
          switchMap((supported) => {
            if (!supported) {
              return of(this.setState('unsupported'));
            }

            // Validamos a capacidade de persistência antes do prompt, mas só
            // criamos a installation id depois da permissão concedida. Assim,
            // quem recusa Web Push não recebe um identificador persistente.
            this.requireLocalStorage();

            const currentPermission = this.notificationPermission();

            if (currentPermission === 'denied') {
              this.removeOptInSafely();
              return of(this.setState('blocked'));
            }

            const permission$ =
              currentPermission === 'default'
                ? this.requestPermission$()
                : of(currentPermission);

            return permission$.pipe(
              switchMap((permission) => {
                if (permission !== 'granted') {
                  this.removeOptInSafely();
                  return of(
                    this.setState(
                      permission === 'denied' ? 'blocked' : 'inactive'
                    )
                  );
                }

                this.sessionForcedOptOut = false;

                return this.session.readyUid$.pipe(
                  take(1),
                  switchMap((uid) => {
                    const safeUid = String(uid ?? '').trim();

                    if (!safeUid) {
                      return throwError(
                        () => new Error('Usuário não autenticado para Web Push.')
                      );
                    }

                    return this.registerForUid$(safeUid, vapidKey).pipe(
                      tap((state) => {
                        if (state === 'active') {
                          this.persistOptInForUid(safeUid);
                        }
                      })
                    );
                  })
                );
              })
            );
          })
        );
      })
    ).pipe(
      catchError((error) =>
        this.failOperation(error, 'activate')
      )
    );
  }

  deactivate$(): Observable<PushNotificationDeviceState> {
    return this.runBusy$(() =>
      defer(() => {
        this.sessionForcedOptOut = true;
        this.removeOptInSafely();

        const installationId = this.readInstallationId();

        return forkJoin({
          backend: installationId
            ? this.unregisterBackend$(installationId).pipe(
                map(() => true),
                catchError((error) => {
                  this.reportError(error, 'unregisterBackend');
                  return of(false);
                })
              )
            : of(true),
          localToken: this.deleteLocalMessagingToken$().pipe(
            map(() => true),
            catchError((error) => {
              this.reportError(error, 'deleteLocalToken');
              return of(false);
            })
          ),
        }).pipe(
          switchMap(({ backend, localToken }) => {
            if (!backend && !localToken) {
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
      })
    ).pipe(
      catchError((error) =>
        this.failOperation(error, 'deactivate')
      )
    );
  }

  ngOnDestroy(): void {
    this.startupSubscription?.unsubscribe();
    this.startupSubscription = null;
  }

  private synchronizeExistingOptInForUid$(
    uid: string
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

      if (!this.hasPersistedOptInForUid(uid)) {
        return of(this.setState('inactive'));
      }

      // Startup nunca chama requestPermission(). Se a permissão foi resetada
      // pelo navegador, a próxima decisão fica novamente a cargo do usuário.
      if (permission !== 'granted') {
        return of(this.setState('inactive'));
      }

      return this.firebaseMessagingSupported$().pipe(
        switchMap((supported) => {
          if (!supported) {
            return of(this.setState('unsupported'));
          }

          return this.registerForUid$(uid, vapidKey);
        })
      );
    });
  }

  private registerForUid$(
    uid: string,
    vapidKey: string
  ): Observable<PushNotificationDeviceState> {
    return defer(() => {
      const installationId = this.ensureInstallationId();

      return this.registerServiceWorker$().pipe(
        switchMap((registration) =>
          this.messaging$().pipe(
            switchMap((messaging) =>
              defer(() =>
                from(
                  getToken(messaging, {
                    vapidKey,
                    serviceWorkerRegistration: registration,
                  })
                )
              )
            )
          )
        ),
        map((token) => String(token ?? '').trim()),
        switchMap((token) => {
          if (token.length < MIN_PUSH_FCM_TOKEN_LENGTH) {
            return throwError(
              () => new Error('FCM não retornou um token Web Push válido.')
            );
          }

          const callable = httpsCallable<
            PushDeviceRegistrationRequest,
            PushDeviceCallableResponse
          >(this.functions, 'registerPushDevice');

          return defer(() =>
            from(
              callable({
                token,
                platform: 'web',
                installationId,
              })
            )
          );
        }),
        map((result) => {
          if (result.data?.ok !== true) {
            throw new Error('Registro do dispositivo Web Push não confirmado.');
          }

          return this.setState('active');
        })
      );
    }).pipe(
      catchError((error) => {
        this.reportError(error, 'registerForUid', {
          authenticated: Boolean(uid),
        });
        return throwError(() => error);
      })
    );
  }

  private unregisterBackend$(installationId: string): Observable<void> {
    const callable = httpsCallable<
      PushDeviceUnregistrationRequest,
      PushDeviceCallableResponse
    >(this.functions, 'unregisterPushDevice');

    return defer(() =>
      from(
        callable({
          installationId,
        })
      )
    ).pipe(
      map((result) => {
        if (result.data?.ok !== true) {
          throw new Error('Remoção do dispositivo Web Push não confirmada.');
        }
      })
    );
  }

  private registerServiceWorker$(): Observable<ServiceWorkerRegistration> {
    return defer(() =>
      from(
        navigator.serviceWorker.register(this.buildServiceWorkerUrl(), {
          updateViaCache: 'none',
        })
      )
    );
  }

  private messaging$(): Observable<Messaging> {
    return defer(() => of(getMessaging(getApp())));
  }

  private deleteLocalMessagingToken$(): Observable<void> {
    if (!this.hasBrowserPushApis()) {
      return of(undefined);
    }

    return this.firebaseMessagingSupported$().pipe(
      switchMap((supported) => {
        if (!supported) {
          return of(undefined);
        }

        return this.messaging$().pipe(
          switchMap((messaging) =>
            defer(() => from(deleteToken(messaging)))
          ),
          map(() => undefined)
        );
      })
    );
  }

  private firebaseMessagingSupported$(): Observable<boolean> {
    return defer(() => from(isSupported())).pipe(
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
    if (this.sessionForcedOptOut) return false;

    const storage = this.requireLocalStorage();
    return storage.getItem(PUSH_OPT_IN_UID_STORAGE_KEY) === uid;
  }

  private persistOptInForUid(uid: string): void {
    const storage = this.requireLocalStorage();
    storage.setItem(PUSH_OPT_IN_UID_STORAGE_KEY, uid);
  }

  private removeOptInSafely(): void {
    try {
      this.requireLocalStorage().removeItem(PUSH_OPT_IN_UID_STORAGE_KEY);
    } catch (error) {
      this.reportError(error, 'persistOptOut');
    }
  }

  private readInstallationId(): string | null {
    const storage = this.requireLocalStorage();
    const existing = String(
      storage.getItem(PUSH_INSTALLATION_STORAGE_KEY) ?? ''
    ).trim();

    return isValidPushInstallationId(existing) ? existing : null;
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
      if (this.busySubject.value) {
        return of(this.stateSubject.value);
      }

      this.busySubject.next(true);

      return sourceFactory().pipe(
        finalize(() => this.busySubject.next(false))
      );
    });
  }

  private setState(
    state: PushNotificationDeviceState
  ): PushNotificationDeviceState {
    this.stateSubject.next(state);
    return state;
  }

  private failOperation(
    error: unknown,
    operation: string
  ): Observable<never> {
    this.setState('error');
    this.reportError(error, operation);
    return throwError(() => error);
  }

  private reportError(
    error: unknown,
    operation: string,
    extra: Record<string, unknown> = {}
  ): void {
    try {
      const reportable = (error instanceof Error
        ? error
        : new Error(
            '[PushNotificationDeviceService] operação Web Push falhou.'
          )) as PushNotificationReportableError;

      reportable.context = 'PushNotificationDeviceService';
      reportable.operation = operation;
      reportable.extra = {
        environment: environment.env,
        state: this.stateSubject.value,
        ...extra,
      };
      reportable.original = error;
      reportable.skipUserNotification = true;

      this.globalError.handleError(reportable);
    } catch {
      // noop
    }
  }
}
