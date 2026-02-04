// src/app/store/effects/effects.user/auth-session-sync.effects.ts
// Não esqueça os comentários
// Ferramentas de debug podem ser úteis aqui, pois lidam com a sincronização entre o estado real da sessão (AuthSession) e o estado do Store.
import { Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, distinctUntilChanged, map, tap } from 'rxjs/operators';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { authSessionChanged } from 'src/app/store/actions/actions.user/auth.actions';
import { environment } from 'src/environments/environment';

@Injectable()
export class AuthSessionSyncEffects {
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
        if (!environment.production) {
          console.log('[AUTH][SYNC_EFFECT] authUser$', u?.uid ?? null);
        }
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
}
