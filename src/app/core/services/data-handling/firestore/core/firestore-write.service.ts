// src/app/core/services/data-handling/firestore/core/firestore-write.service.ts
// Serviço centralizado para escrita no Firestore, com tratamento de erros e contexto
// Não esquecer os comentários e ferramentas de debug para facilitar a manutenção futura
//  Observação: Este serviço é focado apenas em operações de escrita (add, set, update, delete, increment) e deve ser usado por outros serviços/repositórios para garantir consistência e tratamento de erros centralizado. Para leitura, use o FirestoreReadService.
import { Injectable } from '@angular/core';
import { Observable, defer, from } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import {
  Firestore,
  collection,
  deleteDoc,
  doc,
  increment,
  setDoc,
  updateDoc,
  type DocumentData,
} from '@angular/fire/firestore';

import type { WithFieldValue } from 'firebase/firestore';
import { FirestoreContextService } from './firestore-context.service';
import { environment } from 'src/environments/environment';
import { FirestoreErrorHandlerService } from '../../../error-handler/firestore-error-handler.service';

@Injectable({ providedIn: 'root' })
export class FirestoreWriteService {
  constructor(
    private readonly db: Firestore,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly ctx: FirestoreContextService
  ) { }

  private debugLog(message: string, payload?: unknown): void {
    if (environment.enableDebugTools) {
      console.debug('[FirestoreWriteService]', message, payload ?? '');
    }
  }

  /**
   * ✅ Mesma correção “cirúrgica” do Read:
   * Se algo lançar exceção síncrona ANTES do Observable existir (ex.: doc(), collection(), setDoc()),
   * nós embrulhamos em `defer` + try/catch dentro do injection context.
   *
   * Isso garante:
   * - nenhum throw “escapa” fora do RxJS pipeline
   * - todo erro vai para o FirestoreErrorHandlerService (centralizado)
   */
  private inCtx$<T>(
    factory: () => Observable<T>,
    context: string,
    silent = false
  ): Observable<T> {
    return defer(() => {
      try {
        // ✅ tudo que criar refs/chamar APIs AngularFire deve acontecer dentro do ctx.run
        return this.ctx.run(factory);
      } catch (err) {
        return this.firestoreError.handleFirestoreError(err, { context, silent });
      }
    });
  }

  private normalizeCollectionName(name: string): string {
    return (name ?? '').trim();
  }

  private normalizeDocId(id: string): string {
    return (id ?? '').trim();
  }

  addDocument<T extends WithFieldValue<DocumentData>>(
    collectionName: string,
    data: T,
    opts?: { silent?: boolean; context?: string }
  ): Observable<void> {
    const col = this.normalizeCollectionName(collectionName);
    const context = opts?.context ?? 'FirestoreWriteService.addDocument';
    const silent = opts?.silent ?? false;

    this.debugLog('addDocument', { collectionName: col });

    return this.inCtx$(() => {
      if (!col) throw new Error('collectionName inválido.');

      // ✅ sem defer interno: doc/collection/setDoc acontecem dentro do Injection Context
      const colRef = collection(this.db, col);
      const newRef = doc(colRef);

      return from(setDoc(newRef, data)).pipe(
        map(() => void 0),
        catchError((err) => this.firestoreError.handleFirestoreError(err, { context, silent }))
      );
    }, context, silent);
  }

  // ---------------------------------------------------------------------------
  // DEBUG CONTROL (users writes)
  // ---------------------------------------------------------------------------

  private readonly USERS_TRACE_SENSITIVE_KEYS = new Set<string>([
    'role',
    'tier',
    'isSubscriber',
    'accountLocked',
    'accountStatus',
    'suspended',
    'suspensionReason',
    'suspendedAt',
    'moderatedBy',
    'moderatedAt',
    'lastStatusChangeAt',
    'emailVerified',
    'permissions',
    'entitlements',
  ]);

  private readonly USERS_TRACE_CONTEXT_DENY = [
    /^GeolocationTrackingService\./,
    /^PresenceService\./,
    /^PresenceOrchestratorService\./,
    /^UserStateCacheService\./,
    /^CacheService\./,
  ];

  private shouldTraceUsersWrite(
    kind: 'update' | 'set',
    col: string,
    context: string,
    silent: boolean,
    dataKeys: string[],
    merge?: boolean
  ): boolean {
    if (!environment.enableDebugTools || environment.production) return false;
    if (silent === true) return false; // ✅ “best-effort” não polui console
    if (col !== 'users') return false;

    const ctx = (context ?? '').trim();
    const keys = dataKeys ?? [];

    // ✅ se mexe em chave sensível, sempre traça (mesmo se contexto “deny”)
    const touchesSensitive = keys.some((k) => this.USERS_TRACE_SENSITIVE_KEYS.has(k));
    if (touchesSensitive) return true;

    // ✅ updates/sets rotineiros (geo/cache/presence) não precisam de trace
    const deniedByContext = this.USERS_TRACE_CONTEXT_DENY.some((rx) => rx.test(ctx));
    if (deniedByContext) return false;

    // ✅ no set merge:true você pode querer manter (normalmente é “perigoso”)
    if (kind === 'set' && merge === true) return true;

    // default: não traça
    return false;
  }

  setDocument<T extends WithFieldValue<DocumentData>>(
    collectionName: string,
    docId: string,
    data: T,
    opts?: { merge?: boolean; silent?: boolean; context?: string }
  ): Observable<void> {
    const col = this.normalizeCollectionName(collectionName);
    const id = this.normalizeDocId(docId);
    const merge = !!opts?.merge;
    const context = opts?.context ?? 'FirestoreWriteService.setDocument';
    const silent = opts?.silent ?? false;

    this.debugLog('setDocument', { collectionName: col, docId: id, merge });

    return this.inCtx$(() => {
      if (!col) throw new Error('collectionName inválido.');
      if (!id) throw new Error('docId inválido.');

      const dataKeys = Object.keys((data as any) ?? {});
      if (this.shouldTraceUsersWrite('set', col, context, silent, dataKeys, merge)) {
        console.warn('[WRITE users set]', { docId: id, context, merge, dataKeys });
        console.trace();
      }

      return from(setDoc(doc(this.db, col, id), data, { merge })).pipe(
        map(() => void 0),
        catchError((err) => this.firestoreError.handleFirestoreError(err, { context, silent }))
      );
    }, context, silent);
  }

  updateDocument(
    collectionName: string,
    docId: string,
    data: Partial<any>,
    opts?: { silent?: boolean; context?: string }
  ): Observable<void> {
    const col = this.normalizeCollectionName(collectionName);
    const id = this.normalizeDocId(docId);
    const context = opts?.context ?? 'FirestoreWriteService.updateDocument';
    const silent = opts?.silent ?? false;

    this.debugLog('updateDocument', { collectionName: col, docId: id });

    return this.inCtx$(() => {
      if (!col) throw new Error('collectionName inválido.');
      if (!id) throw new Error('docId inválido.');
      if (!data || typeof data !== 'object') throw new Error('data inválido para updateDocument.');

      const dataKeys = Object.keys(data ?? {});
      if (this.shouldTraceUsersWrite('update', col, context, silent, dataKeys)) {
        console.warn('[WRITE users update]', { docId: id, context, dataKeys });
        console.trace();
      }

      return from(updateDoc(doc(this.db, col, id), data)).pipe(
        map(() => void 0),
        catchError((err) => this.firestoreError.handleFirestoreError(err, { context, silent }))
      );
    }, context, silent);
  }

  deleteDocument(
    collectionName: string,
    docId: string,
    opts?: { silent?: boolean; context?: string }
  ): Observable<void> {
    const col = this.normalizeCollectionName(collectionName);
    const id = this.normalizeDocId(docId);
    const context = opts?.context ?? 'FirestoreWriteService.deleteDocument';
    const silent = opts?.silent ?? false;

    this.debugLog('deleteDocument', { collectionName: col, docId: id });

    return this.inCtx$(() => {
      if (!col) throw new Error('collectionName inválido.');
      if (!id) throw new Error('docId inválido.');

      return from(deleteDoc(doc(this.db, col, id))).pipe(
        map(() => void 0),
        catchError((err) => this.firestoreError.handleFirestoreError(err, { context, silent }))
      );
    }, context, silent);
  }

  incrementField(
    collectionName: string,
    docId: string,
    fieldName: string,
    incBy: number,
    opts?: { silent?: boolean; context?: string }
  ): Observable<void> {
    const col = this.normalizeCollectionName(collectionName);
    const id = this.normalizeDocId(docId);
    const field = (fieldName ?? '').trim();
    const context = opts?.context ?? 'FirestoreWriteService.incrementField';
    const silent = opts?.silent ?? false;

    this.debugLog('incrementField', { collectionName: col, docId: id, fieldName: field, incBy });

    return this.inCtx$(() => {
      if (!col) throw new Error('collectionName inválido.');
      if (!id) throw new Error('docId inválido.');
      if (!field) throw new Error('fieldName inválido.');
      if (typeof incBy !== 'number' || Number.isNaN(incBy)) throw new Error('incBy inválido.');

      return from(updateDoc(doc(this.db, col, id), { [field]: increment(incBy) })).pipe(
        map(() => void 0),
        catchError((err) => this.firestoreError.handleFirestoreError(err, { context, silent }))
      );
    }, context, silent);
  }
} //Linha 276, Fim do firestore-write.service.ts
// - O FirestoreWriteService é um serviço centralizado para operações de escrita no Firestore,
// incluindo add, set, update, delete e increment. Ele utiliza um método inCtx$ para garantir que todas as operações sejam executadas dentro do contexto de injeção do Angular,
// permitindo o tratamento centralizado de erros através do FirestoreErrorHandlerService.
// O serviço também inclui ferramentas de debug para rastrear operações sensíveis na coleção "users", com base em chaves específicas e contextos de chamada.
