// src/app/core/services/autentication/auth/auth-session.service.ts
// Não esquecer os comentários
import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay } from 'rxjs/operators';
import { Auth, authState, onAuthStateChanged, signOut, User } from '@angular/fire/auth';

/**
 * =============================================================================
 * AUTH SESSION (Fonte de verdade)
 * - Responsável por expor o estado de autenticação do Firebase Auth (User | null).
 * - Exposição reativa: authUser$ e uid$ (shareReplay + distinctUntilChanged).
 * - NÃO conhece Router, Firestore, Presence, NgRx, nem UI/toast.
 * - NÃO tem efeitos colaterais automáticos (não start/stop em outros serviços).
 *
 * Contratos:
 * - uid$ é a única fonte confiável de UID.
 * - Métodos utilitários (signOut$, revalidateSession$, forceReload$) são ações
 *   explícitas, disparadas por quem orquestra a sessão.
 * =============================================================================
 */

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  readonly authUser$: Observable<User | null>;
  readonly uid$: Observable<string | null>;

  private readyPromise?: Promise<void>;

  constructor(private auth: Auth) {
    this.authUser$ = authState(this.auth).pipe(
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.uid$ = this.authUser$.pipe(
      map(u => u?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  whenReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = new Promise(resolve => {
        const unsubscribe = onAuthStateChanged(this.auth, (_user) => {
          resolve();
          unsubscribe();
        });
      });
    }
    return this.readyPromise;
  }

  signOut$() { return from(signOut(this.auth)); }

  revalidateSession$() {
    const u = this.auth.currentUser;
    if (!u) return of(void 0);
    return from(u.getIdToken(true)).pipe(
      catchError(() => of(void 0))
    );
  }

  //não fazer signOut, deixa o Orchestrator decidir
    forceReload$() {
      const u = this.auth.currentUser;
      if (!u) return of(void 0);

      return from(u.reload()).pipe(
        map(() => void 0),
        catchError((e) => of(void 0)) // ou: throwError(() => e) se você quiser tratar acima
      );
    }


  get currentAuthUser(): User | null {
    return this.auth.currentUser;
  }
}

/* AuthSession manda no UID
CurrentUserStore manda no IUserDados
qualquer UID fora disso vira derivado / compat
Nunca esquecer de ferramentas de debug
É assim que funcionam as grandes plataformas?*/

