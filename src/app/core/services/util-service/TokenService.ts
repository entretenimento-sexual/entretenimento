// src/app/core/services/autentication/TokenService.ts
import { Injectable } from '@angular/core';
import { Auth, User, user, idToken } from '@angular/fire/auth';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, take } from 'rxjs/operators';
import { GlobalErrorHandlerService } from '../error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class TokenService {
  readonly user$: Observable<User | null>;

  constructor(
    private readonly auth: Auth,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {
    this.user$ = user(this.auth).pipe(
      catchError((e) => {
        try { this.globalErrorHandler.handleError(e); } catch { }
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getToken(): Observable<string | null> {
    return idToken(this.auth).pipe(
      take(1),
      catchError((e) => {
        try { this.globalErrorHandler.handleError(e); } catch { }
        return of(null);
      })
    );
  }

  isLoggedIn(): Observable<boolean> {
    return this.user$.pipe(map((u) => !!u));
  }
}
// avaliar descontinuar ou transformar em simples wrapper do AuthSessionService.
