// src/app/store/effects/effects.user/auth-session-sync.effects.ts
// Não esqueça os comentários
// Ferramentas de debug podem ser úteis aqui, pois lidam com a sincronização entre o estado real da sessão (AuthSession) e o estado do Store.

import { Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { of, combineLatest } from 'rxjs';
import { catchError, distinctUntilChanged, filter, map, tap } from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { authSessionChanged } from 'src/app/store/actions/actions.user/auth.actions';
import { observeUserChanges, stopObserveUserChanges } from 'src/app/store/actions/actions.user/user.actions';
import { environment } from 'src/environments/environment';

@Injectable()
export class AuthSessionSyncEffects {
  private readonly debug = !environment.production;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) { }

  /**
   * ✅ Mantém o store sincronizado com a sessão real (Firebase/AuthSession).
   * - Sem depender do fluxo de login/logout do NgRx para refletir o estado real.
   */
  syncAuthSession$ = createEffect(() =>
    this.authSession.authUser$.pipe(
      tap(u => {
        if (this.debug) console.log('[AUTH][SYNC_EFFECT] authUser$', u?.uid ?? null);
      }),
      map(u => ({ uid: u?.uid ?? null, emailVerified: u?.emailVerified === true })),
      distinctUntilChanged((a, b) => a.uid === b.uid && a.emailVerified === b.emailVerified),
      map(({ uid, emailVerified }) => authSessionChanged({ uid, emailVerified })),
      catchError(err => {
        this.globalErrorHandler.handleError(
          err instanceof Error ? err : new Error('Falha ao sincronizar sessão (AuthSession).')
        );
        return of(authSessionChanged({ uid: null, emailVerified: false }));
      })
    )
  );

  /**
   * ✅ PATCH CRÍTICO:
   * Garante que o listener do documento do usuário (users/{uid}) inicie assim que:
   * 1) session.ready$ === true (Auth restaurada)
   * 2) authUser.uid exista
   *
   * E garante o STOP no logout (uid null) para evitar listener “zumbi”.
   *
   * Resultado:
   * - /dashboard/principal passa a ter currentUser$ preenchido sem depender de /perfil.
   */
  ensureCurrentUserListener$ = createEffect(() =>
    combineLatest([this.authSession.ready$, this.authSession.authUser$]).pipe(
      // só começa a “decidir” depois que a sessão está pronta
      filter(([ready]) => ready === true),

      map(([, user]) => user?.uid ?? null),
      distinctUntilChanged(),

      tap((uid) => {
        if (!this.debug) return;
        console.log('[AUTH][SYNC_EFFECT] ensureCurrentUserListener$', { uid });
      }),

      map((uid) => (uid ? observeUserChanges({ uid }) : stopObserveUserChanges())),

      catchError((err) => {
        const e = err instanceof Error ? err : new Error('ensureCurrentUserListener$ falhou');
        (e as any).silent = true;
        (e as any).original = err;
        this.globalErrorHandler.handleError(e);
        return of(stopObserveUserChanges());
      })
    )
  );
}
