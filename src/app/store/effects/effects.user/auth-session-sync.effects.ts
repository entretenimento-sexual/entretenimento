// src/app/store/effects/effects.user/auth-session-sync.effects.ts
// Não esqueça os comentários
// Ferramentas de debug podem ser úteis aqui, pois lidam com a sincronização entre
// o estado real da sessão (AuthSession) e o estado do Store.
import { Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { of, combineLatest, concat } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  delay,
  filter,
  map,
  take,
  tap,
} from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import { authSessionChanged } from 'src/app/store/actions/actions.user/auth.actions';
import {
  observeUserChanges,
  stopObserveUserChanges,
} from 'src/app/store/actions/actions.user/user.actions';

@Injectable()
export class AuthSessionSyncEffects {
  private previousOperationalUid: string | null | undefined;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly privacyDebug: PrivacyDebugLoggerService,
    private readonly cache: CacheService
  ) {}

  /**
   * O reset NgRx ocorre no meta-reducer da action canônica. CacheService
   * mantém entradas efêmeras/persistidas fora do NgRx: precisamos invalidá-las
   * na MESMA transição de UID, inclusive A→B sem logout explícito.
   *
   * A purga de memória é síncrona e a do IndexedDB é best-effort assíncrona;
   * não atrasamos a publicação de authSessionChanged nem abrimos um watcher
   * de sessão independente.
   */
  private purgeAuxiliarySessionCache(uid: string | null): void {
    if (this.previousOperationalUid === uid) return;
    this.previousOperationalUid = uid;

    this.cache.clearSensitiveSessionCache$().pipe(take(1)).subscribe({
      error: (error: unknown) => {
        this.globalErrorHandler.handleError(
          Object.assign(new Error('Falha ao limpar cache de sessão.'), {
            original: error,
            silent: true,
            skipUserNotification: true,
          })
        );
      },
    });
  }

  /**
   * Debug seguro da sincronização entre AuthSession e NgRx Store.
   *
   * Canal:
   * localStorage.setItem('DEBUG_AUTH', '1');
   *
   * Este effect lida com UID e estado de verificação de e-mail.
   * Por isso, não deve usar console.log direto.
   */
  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('auth', `SYNC_EFFECT: ${message}`, extra);
  }

  /**
   * Mantém o store sincronizado com a sessão real do Firebase/AuthSession.
   *
   * Regra importante:
   * - Só decidimos depois de ready$ === true
   * - Isso evita emitir "uid:null" cedo demais no bootstrap
   */
  syncAuthSession$ = createEffect(() =>
    combineLatest([this.authSession.ready$, this.authSession.authUser$]).pipe(
      filter(([ready]) => ready === true),

      map(([, user]) => ({
        uid: user?.uid ?? null,
        emailVerified: user?.emailVerified === true,
      })),

      distinctUntilChanged(
        (a, b) => a.uid === b.uid && a.emailVerified === b.emailVerified
      ),

      tap(({ uid }) => this.purgeAuxiliarySessionCache(uid)),
      tap((session) => this.dbg('authSessionChanged()', session)),

      map(({ uid, emailVerified }) =>
        authSessionChanged({ uid, emailVerified })
      ),

      catchError((err, source) => {
        const error =
          err instanceof Error
            ? err
            : new Error('Falha ao sincronizar sessão (AuthSession).');

        (error as any).silent = true;
        (error as any).original = err;
        (error as any).context = 'AuthSessionSyncEffects.syncAuthSession$';

        try { this.globalErrorHandler.handleError(error); } catch { /* Telemetria não pode derrubar a observação. */ }

        // Recadastra os observadores após falha; sem isso o effect morre.
        return concat(
          of(authSessionChanged({ uid: null, emailVerified: false })),
          source.pipe(delay(1_000))
        );
      })
    )
  );

  /**
   * Garante que o listener do documento do usuário (users/{uid}) acompanhe
   * fielmente a sessão real:
   *
   * - ready=true + uid => observeUserChanges({ uid })
   * - ready=true + uid=null => stopObserveUserChanges()
   *
   * Isso mantém o CurrentUserStore e o NgRx alimentados sem depender
   * de um fluxo manual de login/logout dentro do store.
   */
  ensureCurrentUserListener$ = createEffect(() =>
    combineLatest([this.authSession.ready$, this.authSession.authUser$]).pipe(
      filter(([ready]) => ready === true),

      map(([, user]) => user?.uid ?? null),
      distinctUntilChanged(),

      tap((uid) => this.dbg('ensureCurrentUserListener$', { uid })),

      map((uid) =>
        uid ? observeUserChanges({ uid }) : stopObserveUserChanges()
      ),

      catchError((err) => {
        const error =
          err instanceof Error
            ? err
            : new Error('ensureCurrentUserListener$ falhou');

        (error as any).silent = true;
        (error as any).original = err;
        (error as any).context =
          'AuthSessionSyncEffects.ensureCurrentUserListener$';

        try { this.globalErrorHandler.handleError(error); } catch { /* Telemetria best-effort. */ }

        return concat(
          of(stopObserveUserChanges()),
          source.pipe(delay(1_000))
        );
      })
    )
  );
}
