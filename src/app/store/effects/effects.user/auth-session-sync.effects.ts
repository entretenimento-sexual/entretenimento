//src\app\store\effects\effects.user\auth-session-sync.effects.ts
import { Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { of } from 'rxjs';
import { catchError, distinctUntilChanged, map } from 'rxjs/operators';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { authSessionChanged } from 'src/app/store/actions/actions.user/auth.actions';

@Injectable()
export class AuthSessionSyncEffects {
  constructor(
    private readonly authSession: AuthSessionService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) { }

  syncAuthSession$ = createEffect(() =>
    this.authSession.authUser$.pipe(
      map(u => ({
        uid: u?.uid ?? null,
        emailVerified: u?.emailVerified === true,
      })),
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
// E o auth.effects.ts e console.log ?
