// src/app/core/services/data-handling/firestore/core/firestore-read.service.ts
import { Injectable } from '@angular/core';
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

import { defer, EMPTY, Observable, of, throwError } from 'rxjs';
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
    private readonly auth: Auth
  ) { }

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
    // Observação: currentUser pode ser null durante bootstrap/refresh.
    // A escolha aqui é "não fazer listen" e não estourar erro global em transição de sessão.
    return this.auth.currentUser ? of(null) : of(emptyValue);
  }

  /**
   * Centraliza erro e adiciona contexto útil (sem depender do formato do erro).
   * Mantém o tratamento centralizado (FirestoreErrorHandlerService -> global/error-notification).
   */
  private handleError(
    err: unknown,
    meta: Record<string, unknown>,
    silent?: boolean
  ): Observable<never> {
    // Anexa metadados no erro (ajuda debug sem quebrar fluxo)
    const enriched =
      typeof err === 'object' && err !== null
        ? Object.assign(err as any, { _firestoreReadMeta: meta })
        : Object.assign(new Error(String(err)), { _firestoreReadMeta: meta });

    // silent => não notifica globalmente, mas propaga erro pro caller tratar
    if (silent) return throwError(() => enriched);

    // caminho padrão (centralizado no handler do projeto)
    return this.firestoreError.handleFirestoreError(enriched);
  }

  // ---------------------------------------------------------------------------
  // READ: DOC (once)
  // ---------------------------------------------------------------------------

  /**
   * Lê um documento 1x.
   * Aceita assinatura antiga (source string) e a nova (options object).
   *
   * Ex:
   *   getDocument('users', uid, 'server')
   *   getDocument('public_index', docId, { source: 'server', silent: true, context: 'nickname-soft' })
   */
  getDocument<T>(collectionName: string, docId: string, arg?: GetDocumentArg): Observable<T | null> {
    const opts = this.normalizeGetDocumentArg(arg);

    // Fail-fast para parâmetros inválidos (grandes plataformas preferem bug visível cedo)
    if (!this.isNonEmptyString(collectionName) || !this.isNonEmptyString(docId)) {
      return this.handleError(
        new Error('Parâmetros inválidos: collectionName/docId.'),
        { method: 'getDocument', collectionName, docId, ...opts },
        opts.silent
      );
    }

    // Se o docId depende de auth (ex.: uid), este gate evita chamadas prematuras.
    // Aqui retornamos null (documento inexistente/indisponível) sem notificação global.
    return this.gateAuth$<T | null>(opts.requireAuth, null).pipe(
      switchMap((maybeEmpty) => {
        if (maybeEmpty !== null) return of(maybeEmpty);

        return this.ctx.deferPromise$(() => {
          const ref = doc(this.firestore, `${collectionName}/${docId}`);

          // source default -> getDoc padrão (server + cache)
          if (opts.source === 'default') return getDoc(ref);
          if (opts.source === 'cache') return getDocFromCache(ref);

          // server (padrão forte)
          return getDocFromServer(ref);
        }).pipe(
          map((snap) => (snap.exists() ? (snap.data() as T) : null)),
          catchError((err) =>
            this.handleError(
              err,
              { method: 'getDocument', collectionName, docId, source: opts.source, context: opts.context },
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

  /**
   * Lê uma coleção 1x (query com constraints).
   * - Sempre retorna array (vazio quando não houver docs).
   * - idField é aplicado manualmente (padrão "id").
   */
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

    // Gate opcional (evita query prematura se o caller depende de auth).
    // Retorna [] sem notificação global (cenário comum durante bootstrap).
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
            this.handleError(err, { method: 'getDocumentsOnce', collectionName, source, idField }, false)
          )
        );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // LIVE: COLLECTION (realtime)
  // ---------------------------------------------------------------------------

  /**
   * Escuta uma coleção em tempo real.
   * - Importante: listeners em grande escala exigem cuidado com auth/transições.
   * - Se requireAuth=true e não há user: retorna [] e completa (não inicia listener).
   */
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

    // Gate: evita iniciar listener sem sessão (ou em transição)
    return this.gateAuth$<T[]>(requireAuth, []).pipe(
      switchMap((maybeEmpty) => {
        if (maybeEmpty !== null) return of(maybeEmpty);

        return this.ctx.deferObservable$(() => {
          const colRef = collection(this.firestore, collectionName);
          const qRef = query(colRef, ...(constraints ?? []));
          return collectionData(qRef, { idField }) as Observable<T[]>;
        }).pipe(
          catchError((err) =>
            this.handleError(err, { method: 'getDocumentsLive', collectionName, idField }, false)
          )
        );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // LIVE: DOC (realtime)
  // ---------------------------------------------------------------------------

  /**
   * Escuta um documento em tempo real.
   * - Se docId estiver vazio (muito comum quando depende de uid), retorna null e completa.
   * - Se requireAuth=true e não há user: retorna null e completa (não inicia listener).
   */
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

    // Proteção forte: se docId não existe ainda, não tentamos abrir listener.
    if (!this.isNonEmptyString(docId)) {
      return of(null);
    }

    return this.gateAuth$<T | null>(requireAuth, null).pipe(
      switchMap((maybeEmpty) => {
        if (maybeEmpty !== null) return of(maybeEmpty);

        return this.ctx.deferObservable$(() => {
          const ref = doc(this.firestore, `${collectionName}/${docId}`);
          return docData(ref, { idField }) as Observable<T>;
        }).pipe(
          map((data) => (data ? (data as T) : null)),
          catchError((err) =>
            this.handleError(err, { method: 'getDocumentLive', collectionName, docId, idField }, false)
          )
        );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // (Opcional) utilitário para cenários onde você quer apenas "não fazer nada" em vez de erro.
  // Grandes apps às vezes preferem isso em rotas/guards durante transições.
  // ---------------------------------------------------------------------------

  /**
   * Variante segura para doc live quando você quer "silêncio total" e nunca erro global.
   * Útil em telas que abrem antes do login, mas têm binding para doc do usuário.
   */
  getDocumentLiveSafe<T>(collectionName: string, docId: string, options?: CompatReadOptions): Observable<T | null> {
    return this.getDocumentLive<T>(collectionName, docId, options).pipe(
      catchError(() => of(null))
    );
  }

  /**
   * Variante segura para collection live quando você quer "silêncio total" e nunca erro global.
   */
  getDocumentsLiveSafe<T>(collectionName: string, constraints: QueryConstraint[] = [], options?: CompatReadOptions): Observable<T[]> {
    return this.getDocumentsLive<T>(collectionName, constraints, options).pipe(
      catchError(() => of([]))
    );
  }
}
