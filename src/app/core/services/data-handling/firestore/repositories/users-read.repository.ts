// src/app/core/services/data-handling/firestore/repositories/users-read.repository.ts
// Não esqueça os comentários
//
// Ajustes desta versão:
// - mantém /users como coleção privada
// - NÃO afrouxa as rules do Firestore
// - neutraliza getUsersByUidsOnce$ quando usado indevidamente em fluxo público
// - permission-denied em batch/list de /users passa a retornar [] sem poluir o handler global
//
// Importante:
// - /users continua sendo fonte privada/self/admin
// - fluxos públicos devem migrar para /public_profiles
import { Injectable, Injector, runInInjectionContext } from '@angular/core';
import { from, Observable, of } from 'rxjs';
import { catchError, finalize, map, shareReplay } from 'rxjs/operators';

import {
  Firestore,
  doc,
  docData,
  docSnapshots,
  getDoc,
  getDocFromServer,
} from '@angular/fire/firestore';

import {
  collection,
  CollectionReference,
  documentId,
  getDocs,
  Query,
  query,
  where
} from 'firebase/firestore';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { userConverter } from '@core/services/data-handling/converters/user.firestore-converter';
import { FirestoreErrorHandlerService } from '@core/services/error-handler/firestore-error-handler.service';

@Injectable({ providedIn: 'root' })
export class UsersReadRepository {
  private readonly userWatchCache = new Map<string, Observable<IUserDados | null>>();

  constructor(
    private readonly db: Firestore,
    private readonly injector: Injector,
    private readonly firestoreError: FirestoreErrorHandlerService
  ) {}

  private norm(uid: string): string {
    return (uid ?? '').toString().trim();
  }

  private usersCol(): CollectionReference<IUserDados> {
    return runInInjectionContext(this.injector, () =>
      collection(this.db, 'users').withConverter(userConverter) as CollectionReference<IUserDados>
    );
  }

  private userRef(uid: string) {
    return runInInjectionContext(this.injector, () =>
      doc(this.db, 'users', this.norm(uid)).withConverter(userConverter)
    );
  }

  private isPermissionDenied(err: unknown): boolean {
    const code = (err as any)?.code ?? '';
    const message = String((err as any)?.message ?? '');
    return code === 'permission-denied' || message.includes('Missing or insufficient permissions');
  }

  private dbg(message: string, extra?: unknown): void {
    if (typeof ngDevMode !== 'undefined' && ngDevMode) {
      // eslint-disable-next-line no-console
      console.warn(`[UsersReadRepository] ${message}`, extra ?? '');
    }
  }

  /**
   * watchUser$(uid)
   * - Stream realtime do doc /users/{uid}.
   * - Memoizado: múltiplos subscribers compartilham o MESMO listener.
   * - Em erro (permission-denied / offline etc), retorna null.
   */
  watchUser$(uid: string): Observable<IUserDados | null> {
    const id = this.norm(uid);
    if (!id) return of(null);

    const cached = this.userWatchCache.get(id);
    if (cached) return cached;

    const stream$ = runInInjectionContext(this.injector, () => docData(this.userRef(id))).pipe(
      map(v => (v ?? null) as IUserDados | null),
      catchError(err => {
        this.firestoreError.report(err, { context: 'UsersReadRepository.watchUser$' });
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
      finalize(() => this.userWatchCache.delete(id))
    );

    this.userWatchCache.set(id, stream$);
    return stream$;
  }

  getUser$(uid: string): Observable<IUserDados | null> {
    return this.watchUser$(uid);
  }

  getUserOnce$(uid: string): Observable<IUserDados | null> {
    const id = this.norm(uid);
    if (!id) return of(null);

    return from(runInInjectionContext(this.injector, () => getDoc(this.userRef(id)))).pipe(
      map(snap => (snap.exists() ? (snap.data() ?? null) : null)),
      catchError(err => {
        this.firestoreError.report(err, { context: 'UsersReadRepository.getUserOnce$' });
        return of(null);
      })
    );
  }

  async checkUserExistsFromServer(uid: string): Promise<boolean> {
    const id = this.norm(uid);
    if (!id) return false;

    try {
      const snap = await runInInjectionContext(this.injector, () =>
        getDocFromServer(doc(this.db, 'users', id))
      );
      return snap.exists();
    } catch (e) {
      this.firestoreError.report(e, {
        context: 'UsersReadRepository.checkUserExistsFromServer',
        silent: true
      });
      return true;
    }
  }

  checkUserExistsFromServer$(uid: string): Observable<boolean> {
    return from(this.checkUserExistsFromServer(uid));
  }

  watchUserDocDeleted$(uid: string): Observable<boolean> {
    const id = this.norm(uid);
    if (!id) return of(false);

    const ref = runInInjectionContext(this.injector, () => doc(this.db, 'users', id));
    return runInInjectionContext(this.injector, () => docSnapshots(ref)).pipe(
      map(snap => !snap.exists()),
      catchError(err => {
        this.firestoreError.report(err, { context: 'UsersReadRepository.watchUserDocDeleted$' });
        return of(false);
      })
    );
  }

  /**
   * Batch por "in" (10 por query) - one-shot
   *
   * IMPORTANTE:
   * - este método continua lendo /users (coleção privada)
   * - NÃO usar para UI pública / terceiros
   * - se for chamado indevidamente em fluxo público, permission-denied retorna []
   *   sem disparar erro alto no handler global
   *
   * Motivo:
   * - suas rules de /users permitem get self/admin, mas bloqueiam list/query
   */
  getUsersByUidsOnce$(uids: string[]): Observable<IUserDados[]> {
    const ids = Array.from(
      new Set((uids ?? []).map(x => (x ?? '').toString().trim()).filter(Boolean))
    );

    if (!ids.length) return of([]);

    const col = this.usersCol();
    const groups: string[][] = [];
    for (let i = 0; i < ids.length; i += 10) {
      groups.push(ids.slice(i, i + 10));
    }

    return from((async () => {
      const all: IUserDados[] = [];

      for (const g of groups) {
        const q = query(col, where(documentId(), 'in', g)) as Query<IUserDados>;
        const snap = await getDocs(q);
        snap.forEach(d => all.push(d.data()));
      }

      return all;
    })()).pipe(
      catchError(err => {
        if (this.isPermissionDenied(err)) {
          this.dbg('getUsersByUidsOnce$ bloqueado pelas rules de /users; retornando []', {
            count: ids.length,
          });
          return of([]);
        }

        this.firestoreError.report(err, {
          context: 'UsersReadRepository.getUsersByUidsOnce$'
        });
        return of([]);
      })
    );
  }
} // Linha 210