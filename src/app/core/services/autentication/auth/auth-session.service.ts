// src/app/core/services/autentication/auth/auth-session.service.ts
import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { Auth, authState, signOut, User } from '@angular/fire/auth'; // ✅ AngularFire

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  readonly authUser$: Observable<User | null>;

  constructor(private auth: Auth) {
    // AngularFire já cuida do zone: nada de Observable manual + NgZone.
    this.authUser$ = authState(this.auth).pipe(shareReplay(1));
  }

  signOut$(): Observable<void> {
    return from(signOut(this.auth));
  }

  /** Força atualização do token; se o usuário foi apagado/desativado, cai aqui. */
  revalidateSession$(): Observable<void> {
    const u = this.auth.currentUser;
    if (!u) return of(void 0);
    return from(u.getIdToken(true)).pipe(
      map(() => void 0),
      catchError(() => this.signOut$())
    );
  }

  /** Em alguns cenários, reload() detecta remoção/disable mais rápido. */
  forceReload$(): Observable<void> {
    const u = this.auth.currentUser;
    if (!u) return of(void 0);
    return from(u.reload()).pipe(
      map(() => void 0),
      catchError(() => this.signOut$())
    );
  }

  get currentAuthUser() {
    return this.auth.currentUser;
  }
}
