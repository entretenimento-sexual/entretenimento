// src/app/store/effects/effects.user/auth-session-sync.effects.ts
// Não esqueça os comentários
// Ferramentas de debug podem ser úteis aqui, pois lidam com a sincronização entre
// o estado real da sessão (AuthSession) e o estado do Store.
import { Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { of, combineLatest } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  tap,
} from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { authSessionChanged } from 'src/app/store/actions/actions.user/auth.actions';
import {
  observeUserChanges,
  stopObserveUserChanges,
} from 'src/app/store/actions/actions.user/user.actions';
import { environment } from 'src/environments/environment';

@Injectable()
export class AuthSessionSyncEffects {
  private readonly debug = !environment.production;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[AUTH][SYNC_EFFECT] ${message}`, extra ?? '');
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

      tap((session) => this.dbg('authSessionChanged()', session)),

      map(({ uid, emailVerified }) =>
        authSessionChanged({ uid, emailVerified })
      ),

      catchError((err) => {
        const error =
          err instanceof Error
            ? err
            : new Error('Falha ao sincronizar sessão (AuthSession).');

        (error as any).silent = true;
        (error as any).original = err;
        (error as any).context = 'AuthSessionSyncEffects.syncAuthSession$';

        this.globalErrorHandler.handleError(error);

        return of(authSessionChanged({ uid: null, emailVerified: false }));
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

        this.globalErrorHandler.handleError(error);

        return of(stopObserveUserChanges());
      })
    )
  );
}
