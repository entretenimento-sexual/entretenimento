import type { User } from 'firebase/auth';
import { EMPTY, Observable, catchError, defer, filter, finalize, merge, shareReplay, takeUntil, tap, throwError } from 'rxjs';
import type { AuthSessionService } from './auth-session.service';

type SessionScope = Pick<AuthSessionService,
  'uid$' | 'currentAuthUser' | 'terminationVersionSnapshot' | 'isTerminatingSnapshot'> &
  Partial<Pick<AuthSessionService, 'authUser$'>>;

interface PendingRead<T> {
  readonly user: User;
  readonly version: number;
  readonly stream$: Observable<T>;
}

/**
 * Compartilha exclusivamente leituras one-shot simultâneas e idênticas.
 * A Promise de uma callable não é abortável: mantenha a assinatura em voo
 * se apenas a rota desaparecer, mas descarte imediatamente ao revogar sessão.
 * Não usar para escritas, listeners contínuos ou cache de autorização.
 */
export class SessionReadInFlight<T> {
  private readonly pending = new Map<string, PendingRead<T>>();

  constructor(private readonly session: SessionScope) {}

  read$(requestKey: string, load: () => Observable<T>, expectedUid?: string): Observable<T> {
    return defer(() => {
      const user = this.session.currentAuthUser;
      const version = this.session.terminationVersionSnapshot;
      if (!user?.uid || this.session.isTerminatingSnapshot) {
        return throwError(() => Object.assign(new Error('Sessão indisponível para leitura.'), {
          code: 'functions/unauthenticated',
        }));
      }
      if (expectedUid !== undefined && expectedUid !== user.uid) {
        return throwError(() => Object.assign(new Error('A sessão ativa não corresponde à leitura solicitada.'), {
          code: 'functions/permission-denied',
        }));
      }

      const key = JSON.stringify([user.uid, requestKey]);
      const isCurrent = () => this.session.currentAuthUser === user &&
        this.session.terminationVersionSnapshot === version && !this.session.isTerminatingSnapshot;
      const existing = this.pending.get(key);
      if (existing && existing.user === user && existing.version === version) {
        return existing.stream$;
      }

      let entry: PendingRead<T>;
      const release = () => {
        if (this.pending.get(key) === entry) this.pending.delete(key);
      };
      const uidRevoked$ = this.session.uid$.pipe(filter(uid => uid !== user.uid || !isCurrent()));
      // UID streams may suppress same-UID emissions. Release retained reads
      // when the operational authentication authority reports a replacement.
      const revoked$ = this.session.authUser$ ? merge(uidRevoked$,
        this.session.authUser$.pipe(filter(active => active !== user || !isCurrent()))) : uidRevoked$;
      const stream$ = defer(load).pipe(
        takeUntil(revoked$),
        filter(() => isCurrent()),
        // A same-UID SDK replacement may not emit on uid$. Never deliver its stale error.
        catchError(error => isCurrent() ? throwError(() => error) : EMPTY),
        // Remove before forwarding a result/error, including reentrant reads.
        tap({ next: release, error: release, complete: release }),
        finalize(release),
        shareReplay({ bufferSize: 1, refCount: false })
      );
      entry = { user, version, stream$ };
      this.pending.set(key, entry);
      return stream$;
    });
  }
}
