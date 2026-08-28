// src/app/core/services/data-handling/queries/user-discovery-presence.facade.ts
// -----------------------------------------------------------------------------
// Composição de consultas específicas de public_profiles com presença.
//
// Importante:
// - não oferece listagem integral de perfis;
// - presença só é observada quando o gate canônico permite;
// - falha de presença degrada para perfis offline sem bloquear a descoberta;
// - erros passam pelos serviços centrais.
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';
import { QueryConstraint } from 'firebase/firestore';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';

import { UserDiscoveryQueryService } from './user-discovery.query.service';
import { UserPresenceQueryService } from './user-presence.query.service';

@Injectable({ providedIn: 'root' })
export class UserDiscoveryPresenceFacade {
  private readonly debug = !environment.production;
  private lastNotifyAt = 0;

  private readonly onlineUsers$ = this.access.canRunOnlineUsers$.pipe(
    distinctUntilChanged(),
    tap((canRun) => this.dbg('gate(onlineUsers$)', { canRun })),
    switchMap((canRun) =>
      canRun
        ? this.presence.getOnlineUsers$()
        : of([] as IUserDados[])
    ),
    catchError((error) => {
      this.reportSilent(
        error,
        'UserDiscoveryPresenceFacade.onlineUsers$'
      );
      this.notifyOnce(
        'Falha ao obter status online. Exibindo perfis sem presença.'
      );
      return of([] as IUserDados[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly discovery: UserDiscoveryQueryService,
    private readonly presence: UserPresenceQueryService,
    private readonly access: AccessControlService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotifier: ErrorNotificationService
  ) {}

  searchUsersWithPresence$(
    constraints: QueryConstraint[]
  ): Observable<IUserDados[]> {
    return this.discovery.searchUsers(constraints ?? []).pipe(
      switchMap((profiles) => this.withPresence$(profiles)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getProfilesByOrientationAndLocationWithPresence$(
    gender: string,
    orientation: string,
    municipio: string
  ): Observable<IUserDados[]> {
    return this.discovery
      .getProfilesByOrientationAndLocation(
        gender,
        orientation,
        municipio
      )
      .pipe(
        switchMap((profiles) => this.withPresence$(profiles)),
        shareReplay({ bufferSize: 1, refCount: true })
      );
  }

  private withPresence$(
    profiles: IUserDados[]
  ): Observable<IUserDados[]> {
    if (!profiles?.length) {
      return of([]);
    }

    return this.onlineUsers$.pipe(
      map((onlineUsers) =>
        this.mergePresence(profiles, onlineUsers)
      )
    );
  }

  private mergePresence(
    profiles: IUserDados[],
    onlineList: IUserDados[]
  ): IUserDados[] {
    const onlineByUid = new Map<string, IUserDados>();

    for (const onlineUser of onlineList ?? []) {
      const uid = this.toCleanText(onlineUser?.uid);

      if (uid) {
        onlineByUid.set(uid, onlineUser);
      }
    }

    return (profiles ?? []).map((profile) => {
      const uid = this.toCleanText(profile?.uid);
      const presence = uid ? onlineByUid.get(uid) : null;

      if (!presence) {
        return {
          ...profile,
          isOnline: false,
          lastSeen: profile.lastSeen ?? null,
        } as IUserDados;
      }

      const presenceData = presence as any;

      return {
        ...profile,
        isOnline: true,
        lastSeen:
          presenceData.lastSeen ?? profile.lastSeen ?? null,
        lastOnlineAt:
          presenceData.lastOnlineAt ??
          profile.lastOnlineAt ??
          null,
        lastOfflineAt:
          presenceData.lastOfflineAt ??
          profile.lastOfflineAt ??
          null,
        ...(typeof presenceData.presenceState !== 'undefined'
          ? { presenceState: presenceData.presenceState }
          : {}),
      } as IUserDados;
    });
  }

  private dbg(
    message: string,
    extra?: Record<string, unknown>
  ): void {
    if (!this.debug) {
      return;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[UserDiscoveryPresenceFacade] ${message}`,
      extra ?? {}
    );
  }

  private reportSilent(error: unknown, context: string): void {
    try {
      const normalized =
        error instanceof Error ? error : new Error(context);

      (normalized as any).silent = true;
      (normalized as any).skipUserNotification = true;
      (normalized as any).context = context;
      (normalized as any).original = error;

      this.globalErrorHandler.handleError(normalized);
    } catch {
      // noop
    }
  }

  private notifyOnce(message: string): void {
    const now = Date.now();

    if (now - this.lastNotifyAt <= 15_000) {
      return;
    }

    this.lastNotifyAt = now;
    this.errorNotifier.showError(message);
  }

  private toCleanText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const text = value.trim();
    return text.length ? text : null;
  }
}
