// src/app/core/services/autentication/auth/auth-session.service.ts
import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { catchError, filter, map, shareReplay, take } from 'rxjs/operators';
import { Auth, authState, onAuthStateChanged, signOut, User } from '@angular/fire/auth';

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  readonly authUser$: Observable<User | null>;
  private readyPromise?: Promise<void>;

  constructor(private auth: Auth) {
    this.authUser$ = authState(this.auth).pipe(shareReplay(1));
  }

  /**
   * ✅ LÓGICA CORRIGIDA E DEFINITIVA
   * Cria uma promessa que só é resolvida na PRIMEIRA vez que onAuthStateChanged é disparado.
   * Isso garante que a restauração da sessão do Firebase (do IndexedDB) foi concluída.
   * Esta é a forma mais robusta de pausar a aplicação com APP_INITIALIZER.
   */
  whenReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = new Promise(resolve => {
        // onAuthStateChanged garante que o callback só é chamado após a verificação inicial da persistência.
        const unsubscribe = onAuthStateChanged(this.auth, (_user) => {
          resolve(); // Resolve a promessa na primeira emissão (seja user ou null).
          unsubscribe(); // Remove o listener imediatamente para não ser chamado novamente.
        });
      });
    }
    return this.readyPromise;
  }

  signOut$() {
    return from(signOut(this.auth));
  }

  revalidateSession$() {
    const u = this.auth.currentUser;
    if (!u) return of(void 0);
    return from(u.getIdToken(true)).pipe(
      catchError(err => {
        console.log('[revalidate] falhou', err);
        return of(void 0);
      })
    );
  }

  forceReload$() {
    const u = this.auth.currentUser; if (!u) return of(void 0);
    return from(u.reload()).pipe(map(() => void 0), catchError(() => this.signOut$()));
  }

  get currentAuthUser(): User | null {
    return this.auth.currentUser;
  }
}
