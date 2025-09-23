// src/app/core/services/autentication/auth/auth-session.service.ts
import { Injectable, Inject, NgZone } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { onAuthStateChanged, type Auth, type User, signOut } from 'firebase/auth';
import { shareReplay } from 'rxjs/operators';
import { FIREBASE_AUTH } from '@core/firebase/firebase.tokens';

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  readonly authUser$: Observable<User | null>;

  constructor(@Inject(FIREBASE_AUTH) private auth: Auth, private ngZone: NgZone) {
    this.authUser$ = new Observable<User | null>((observer) => {
      const unsub = onAuthStateChanged(
        this.auth,
        (u) => this.ngZone.run(() => observer.next(u)),
        (err) => this.ngZone.run(() => observer.error?.(err))
      );
      return () => unsub();
    }).pipe(shareReplay(1));
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
      catchError(() => this.signOut$()) // se falhar → sai
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

  get currentAuthUser(): User | null {
    return this.auth.currentUser;
  }
}
