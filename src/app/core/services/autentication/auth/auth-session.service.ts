// src/app/core/services/autentication/auth/auth-session.service.ts
// Não esquecer os comentários explicativos sobre o propósito do serviço.
//
// Fonte única da SESSÃO do Firebase/Auth.
//
// Responsabilidades:
// - Expor o usuário autenticado real do Firebase
// - Expor uid$, ready$ e emailVerified$
// - Oferecer utilitário whenReady() para bootstrap seguro
//
// Não faz:
// - Não busca perfil do app (IUserDados)
// - Não decide acesso de produto
// - Não orquestra watchers de Firestore
//
// Observação arquitetural:
// - AuthSessionService = verdade da sessão
// - CurrentUserStoreService = verdade do perfil do app
// - LogoutService = dono do signOut com side-effects
import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { Observable, defer, from, of } from 'rxjs';
import {
  catchError,
  combineLatestWith,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
} from 'rxjs/operators';
import {
  Auth,
  onAuthStateChanged,
  signOut,
  User,
} from '@angular/fire/auth';
import { environment } from 'src/environments/environment';
import { onIdTokenChanged } from 'firebase/auth';

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  /**
   * Usuário real do Firebase Auth.
   * Fonte única da sessão autenticada.
   */
  readonly authUser$: Observable<User | null>;

  /**
   * UID derivado do authUser$.
   */
  readonly uid$: Observable<string | null>;

  /**
   * Gate de bootstrap:
   * - TRUE quando o Firebase Auth terminou de restaurar o estado inicial.
   * - Evita decisões prematuras no cold start / refresh.
   */
  readonly ready$: Observable<boolean>;

  /**
   * Email verificado segundo o Firebase Auth.
   * Já considera o gate ready$.
   */
  readonly emailVerified$: Observable<boolean>;

  /**
   * Conveniência: usuário autenticado após bootstrap resolvido.
   */
  readonly isAuthenticated$: Observable<boolean>;

  /**
   * Cache da promise de bootstrap.
   * Mantém idempotência em múltiplos consumidores.
   */
  private readyPromise: Promise<void> | null = null;

  private readonly debug = !environment.production;

  constructor(
    private readonly auth: Auth,
    private readonly envInjector: EnvironmentInjector
  ) {
    this.authUser$ = new Observable<User | null>((subscriber) => {
      const unsub = onIdTokenChanged(
        this.auth,
        (user) => subscriber.next(user),
        (err) => subscriber.error(err)
      );
      return () => unsub();
    }).pipe(
      distinctUntilChanged(
        (a, b) =>
          (a?.uid ?? null) === (b?.uid ?? null) &&
          (a?.emailVerified ?? false) === (b?.emailVerified ?? false)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.uid$ = this.authUser$.pipe(
      map((user) => user?.uid ?? null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    /**
     * ready$:
     * - começa em false
     * - vira true quando o Auth restaurar o estado inicial
     *
     * Em caso de erro inesperado no bootstrap, fazemos fail-open do ready$
     * para não travar a aplicação indefinidamente.
     * O bloqueio real continua sendo responsabilidade dos gates superiores.
     */
    this.ready$ = defer(() => from(this.whenReady())).pipe(
      map(() => true),
      startWith(false),
      catchError((err) => {
        this.dbg('ready$ error', err);
        return of(true);
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.emailVerified$ = this.ready$.pipe(
      combineLatestWith(this.authUser$),
      map(([ready, user]) => ready === true && user?.emailVerified === true),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.isAuthenticated$ = this.ready$.pipe(
      combineLatestWith(this.authUser$),
      map(([ready, user]) => ready === true && !!user?.uid),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private dbg(message: string, extra?: unknown): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log(`[AuthSessionService] ${message}`, extra ?? '');
  }

  /**
   * whenReady():
   * - Prefere authStateReady() quando existir
   * - Fallback para onAuthStateChanged()
   *
   * Regra:
   * - resolve uma única vez por ciclo de vida do serviço
   * - não mistura perfil do app aqui
   */
  whenReady(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    const authAny = this.auth as any;

    const basePromise: Promise<void> =
      typeof authAny?.authStateReady === 'function'
        ? Promise.resolve(authAny.authStateReady()).then(() => void 0)
        : new Promise<void>((resolve, reject) => {
            const unsubscribe = onAuthStateChanged(
              this.auth,
              (user) => {
                this.dbg('whenReady resolved (onAuthStateChanged)', {
                  uid: user?.uid ?? null,
                });
                resolve();
                unsubscribe();
              },
              (err) => {
                this.dbg('whenReady rejected (onAuthStateChanged)', err);
                reject(err);
                unsubscribe();
              }
            );
          });

    this.readyPromise = basePromise.then(() => {
      this.dbg('whenReady resolved', {
        uid: this.auth.currentUser?.uid ?? null,
      });
    });

    return this.readyPromise;
  }

  /**
   * Compat API.
   * Idealmente, o app deve preferir LogoutService para sair da sessão,
   * porque lá vivem presença, navegação e limpeza coordenada.
   *
   * Este método existe para compatibilidade, mas já respeita
   * o Injection Context exigido pelo AngularFire.
   */
  signOut$(): Observable<void> {
    return defer(() =>
      from(runInInjectionContext(this.envInjector, () => signOut(this.auth)))
    ).pipe(map(() => void 0));
  }

  /**
   * Snapshot síncrono do usuário autenticado atual.
   * Útil apenas para leitura defensiva.
   */
  get currentAuthUser(): User | null {
    return this.auth.currentUser;
  }
}
/*
src/app/core/services/autentication/auth/auth-session.service.ts
src/app/core/services/autentication/auth/current-user-store.service.ts
src/app/core/services/autentication/auth/auth-orchestrator.service.ts
src/app/core/services/autentication/auth/auth.facade.ts
src/app/core/services/autentication/auth/logout.service.ts
*/
// Verificar migrações de responsabilidades para o:
// 1 - auth-route-context.service.ts, e;
// 2 - auth-user-document-watch.service.ts, e;
// 3 - auth-session-monitor.service.ts.

