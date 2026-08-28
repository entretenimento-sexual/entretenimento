// src/app/core/services/data-handling/firestore/core/firestore-read.service.ts
// Serviço genérico de leitura do Firestore com tratamento de erros,
// compatibilidade de assinaturas e proteção para listeners live.
//
// Ajuste importante nesta versão:
// - collectionData()/docData() passam a rodar dentro de runInInjectionContext()
// - isso reduz o risco de warning/erro do AngularFire fora de injection context
//
// Mantido:
// - nomes dos métodos
// - estratégia reativa
// - tratamento centralizado de erros
// - compatibilidade com chamadas existentes

import { EnvironmentInjector, Injectable, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  doc,
  collection,
  query,
  getDoc,
  getDocs,
  getDocFromServer,
  getDocFromCache,
  getDocsFromServer,
  getDocsFromCache,
  collectionData,
  docData,
} from '@angular/fire/firestore';

import type { QueryConstraint } from 'firebase/firestore';

import { Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { FirestoreContextService } from './firestore-context.service';
import { FirestoreErrorHandlerService } from '../../../error-handler/firestore-error-handler.service';

export type DocSource = 'default' | 'server' | 'cache';

/**
 * Compat com assinaturas antigas (sem quebrar código existente).
 * - idField e mapIdField: ambos suportados, priorizamos idField.
 * - useCache/cacheTTL: ignorados aqui (cache é responsabilidade de CacheService / camada acima).
 */
type CompatReadOptions = {
  idField?: string;
  mapIdField?: string;

  source?: DocSource;

  // compat (não usados neste serviço)
  useCache?: boolean;
  cacheTTL?: number;

  /**
   * Quando true, evita iniciar "listen" (docData/collectionData) se não houver usuário autenticado.
   * Isso previne cenários comuns de erro quando o app ainda está resolvendo sessão.
   */
  requireAuth?: boolean;
};

export interface GetDocumentOptions {
  source?: DocSource;

  /**
   * Quando true, o serviço NÃO dispara o handler central (evita toast/logs globais).
   * Ainda assim o erro é propagado no Observable (para o caller decidir).
   */
  silent?: boolean;

  /**
   * Tag humana para rastrear de onde veio a leitura (ajuda em debug/telemetria).
   * Ex: "nickname-soft", "profile-load", etc.
   */
  context?: string;

  /**
   * Opcional: força a mesma proteção de auth do live (útil se o docId depende do uid).
   */
  requireAuth?: boolean;
}

type GetDocumentArg = DocSource | GetDocumentOptions;

@Injectable({ providedIn: 'root' })
export class FirestoreReadService {
  constructor(
    private readonly firestore: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly auth: Auth,
    private readonly environmentInjector: EnvironmentInjector
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers de normalização / segurança
  // ---------------------------------------------------------------------------

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private resolveIdField(options?: CompatReadOptions, fallback = 'id'): string {
    return options?.idField ?? options?.mapIdField ?? fallback;
  }

  private normalizeGetDocumentArg(arg?: GetDocumentArg): GetDocumentOptions {
    if (!arg) return { source: 'server', silent: false };
    if (typeof arg === 'string') return { source: arg, silent: false };
    return {
      source: arg.source ?? 'server',
      silent: !!arg.silent,
      context: arg.context,
      requireAuth: arg.requireAuth,
    };
  }

  private resolveSource(options?: CompatReadOptions, fallback: DocSource = 'server'): DocSource {
    return options?.source ?? fallback;
  }

  /**
   * Gate reativo para auth (sem side effects).
   * - Se requireAuth=false: libera imediatamente
   * - Se requireAuth=true:
   *   - com usuário: libera
   *   - sem usuário: retorna um Observable que completa com valor "vazio" (caller escolhe null/[])
   */
  private gateAuth$<T>(requireAuth: boolean | undefined, emptyValue: T): Observable<T | null> {
    if (!requireAuth) return of(null);
    return this.auth.currentUser ? of(null) : of(emptyValue);
  }

  /**
   * Centraliza erro e adiciona contexto útil.
   * Mantém o tratamento centralizado (FirestoreErrorHandlerService -> global/error-notification).
   */
  private handleError(
    err: unknown,
    meta: Record<string, unknown>,
    silent?: boolean
  ): Observable<never> {
    const enriched =
      typeof err === 'object' && err !== null
        ? Object.assign(err as any, { _firestoreReadMeta: meta })
        : Object.assign(new Error(String(err)), { _firestoreReadMeta: meta });

    if (silent) return throwError(() => enriched);

    return this.firestoreError.handleFirestoreError(enriched);
  }

  /**
   * Garante que APIs do AngularFire que dependem de injection context
   * rodem dentro de runInInjectionContext().
   *
   * Uso:
   * - collectionData(...)
   * - docData(...)
   */
  private runInAngularInjectionContext<T>(factory: () => T): T {
    return runInInjectionContext(this.environmentInjector, factory);
  }

  // ---------------------------------------------------------------------------
  // READ: DOC (once)
  // ---------------------------------------------------------------------------

  getDocument<T>(collectionName: string, docId: string, arg?: GetDocumentArg): Observable<T | null> {
    const opts = this.normalizeGetDocumentArg(arg);

    if (!this.isNonEmptyString(collectionName) || !this.isNonEmptyString(docId)) {
      return this.handleError(
        new Error('Parâmetros inválidos: collectionName/docId.'),
        { method: 'getDocument', collectionName, docId, ...opts },
        opts.silent
      );
    }

    return this.gateAuth$<T | null>(opts.requireAuth, null).pipe(
      switchMap((maybeEmpty) => {
        if (maybeEmpty !== null) return of(maybeEmpty);

        return this.ctx.deferPromise$(() => {
          const ref = doc(this.firestore, `${collectionName}/${docId}`);

          if (opts.source === 'default') return getDoc(ref);
          if (opts.source === 'cache') return getDocFromCache(ref);
          return getDocFromServer(ref);
        }).pipe(
          map((snap) => (snap.exists() ? (snap.data() as T) : null)),
          catchError((err) =>
            this.handleError(
              err,
              {
                method: 'getDocument',
                collectionName,
                docId,
                source: opts.source,
                context: opts.context,
              },
              opts.silent
            )
          )
        );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // READ: COLLECTION (once)
  // ---------------------------------------------------------------------------

  getDocumentsOnce<T>(
    collectionName: string,
    constraints: QueryConstraint[] = [],
    options?: CompatReadOptions
  ): Observable<T[]> {
    const source = this.resolveSource(options, 'server');
    const idField = this.resolveIdField(options, 'id');
    const requireAuth = !!options?.requireAuth;

    if (!this.isNonEmptyString(collectionName)) {
      return this.handleError(
        new Error('Parâmetro inválido: collectionName.'),
        { method: 'getDocumentsOnce', collectionName, source, idField },
        false
      );
    }

    return this.gateAuth$<T[]>(requireAuth, []).pipe(
      switchMap((maybeEmpty) => {
        if (maybeEmpty !== null) return of(maybeEmpty);

        return this.ctx.deferPromise$(() => {
          const colRef = collection(this.firestore, collectionName);
          const qRef = query(colRef, ...(constraints ?? []));

          if (source === 'default') return getDocs(qRef);
          if (source === 'cache') return getDocsFromCache(qRef);
          return getDocsFromServer(qRef);
        }).pipe(
          map((snap) => snap.docs.map((d) => ({ ...(d.data() as any), [idField]: d.id } as T))),
          catchError((err) =>
            this.handleError(
              err,
              { method: 'getDocumentsOnce', collectionName, source, idField },
              false
            )
          )
        );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // LIVE: COLLECTION (realtime)
  // ---------------------------------------------------------------------------

  getDocumentsLive<T>(
    collectionName: string,
    constraints: QueryConstraint[] = [],
    options?: CompatReadOptions
  ): Observable<T[]> {
    const idField = this.resolveIdField(options, 'id');
    const requireAuth = !!options?.requireAuth;

    if (!this.isNonEmptyString(collectionName)) {
      return this.handleError(
        new Error('Parâmetro inválido: collectionName.'),
        { method: 'getDocumentsLive', collectionName, idField },
        false
      );
    }

    return this.gateAuth$<T[]>(requireAuth, []).pipe(
      switchMap((maybeEmpty) => {
        if (maybeEmpty !== null) return of(maybeEmpty);

        return this.ctx.deferObservable$(() => {
          const colRef = collection(this.firestore, collectionName);
          const qRef = query(colRef, ...(constraints ?? []));

          return this.runInAngularInjectionContext(
            () => collectionData(qRef, { idField }) as Observable<T[]>
          );
        }).pipe(
          catchError((err) =>
            this.handleError(
              err,
              { method: 'getDocumentsLive', collectionName, idField },
              false
            )
          )
        );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // LIVE: DOC (realtime)
  // ---------------------------------------------------------------------------

  getDocumentLive<T>(
    collectionName: string,
    docId: string,
    options?: CompatReadOptions
  ): Observable<T | null> {
    const idField = this.resolveIdField(options, 'id');
    const requireAuth = !!options?.requireAuth;

    if (!this.isNonEmptyString(collectionName)) {
      return this.handleError(
        new Error('Parâmetro inválido: collectionName.'),
        { method: 'getDocumentLive', collectionName, docId, idField },
        false
      );
    }

    if (!this.isNonEmptyString(docId)) {
      return of(null);
    }

    return this.gateAuth$<T | null>(requireAuth, null).pipe(
      switchMap((maybeEmpty) => {
        if (maybeEmpty !== null) return of(maybeEmpty);

        return this.ctx.deferObservable$(() => {
          const ref = doc(this.firestore, `${collectionName}/${docId}`);

          return this.runInAngularInjectionContext(
            () => docData(ref, { idField }) as Observable<T>
          );
        }).pipe(
          map((data) => (data ? (data as T) : null)),
          catchError((err) =>
            this.handleError(
              err,
              { method: 'getDocumentLive', collectionName, docId, idField },
              false
            )
          )
        );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // SAFE helpers
  // ---------------------------------------------------------------------------

  getDocumentLiveSafe<T>(
    collectionName: string,
    docId: string,
    options?: CompatReadOptions
  ): Observable<T | null> {
    return this.getDocumentLive<T>(collectionName, docId, options).pipe(
      catchError(() => of(null))
    );
  }

  getDocumentsLiveSafe<T>(
    collectionName: string,
    constraints: QueryConstraint[] = [],
    options?: CompatReadOptions
  ): Observable<T[]> {
    return this.getDocumentsLive<T>(collectionName, constraints, options).pipe(
      catchError(() => of([]))
    );
  }
} // Linha 373