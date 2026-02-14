// src/app/core/services/autentication/auth/auth-session.service.ts
// Não esquecer os comentários explicativos sobre o propósito do serviço.
import { Injectable } from '@angular/core';
import { Observable, from, of, defer } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay } from 'rxjs/operators';
import { Auth, authState, onAuthStateChanged, signOut, User } from '@angular/fire/auth';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  readonly authUser$: Observable<User | null>;
  readonly uid$: Observable<string | null>;

  /**
   * Gate de bootstrap:
   * - TRUE quando o Firebase Auth terminou de restaurar o estado inicial.
   * - Evita “ready=true com uid=null transitório” e redirects prematuros.
   */
  readonly ready$: Observable<boolean>;

  /** Conveniência: logado (após ready). */
  readonly isAuthenticated$: Observable<boolean>;

  // ✅ não opcional (evita TS2322)
  private readyPromise: Promise<void> | null = null;

  private readonly debug = !environment.production;

  constructor(private auth: Auth) {
    this.authUser$ = authState(this.auth).pipe(
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.uid$ = this.authUser$.pipe(
      map(u => u?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Versão Observable do whenReady()
    this.ready$ = defer(() => from(this.whenReady())).pipe(
      map(() => true),
      catchError(() => of(true)), // não trava app se der algo estranho
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.isAuthenticated$ = this.authUser$.pipe(
      map(u => !!u),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private dbg(msg: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[AuthSessionService] ${msg}`, extra ?? '');
  }

  /**
   * whenReady():
   * - Preferimos authStateReady() quando existir (mais correto).
   * - Fallback para onAuthStateChanged apenas se authStateReady não existir.
   */
  whenReady(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    const authAny = this.auth as any;

    const p = (typeof authAny?.authStateReady === 'function')
      ? authAny.authStateReady()
      : new Promise<void>((resolve) => {
        const unsubscribe = onAuthStateChanged(this.auth, (user) => {
          this.dbg('whenReady resolved (onAuthStateChanged)', { uid: user?.uid ?? null });
          resolve();
          unsubscribe();
        });
      });

    this.readyPromise = Promise.resolve(p).then(() => {
      this.dbg('whenReady resolved', { uid: this.auth.currentUser?.uid ?? null });
    });

    return this.readyPromise;
  }

  signOut$() { return from(signOut(this.auth)); }

  get currentAuthUser(): User | null {
    return this.auth.currentUser;
  }
}
