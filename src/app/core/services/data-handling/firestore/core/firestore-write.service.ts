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

      // ✅ defer garante que qualquer throw daqui (collection/doc/setDoc) seja capturado
      return defer(() => {
        const colRef = collection(this.db, col);
        const newRef = doc(colRef); // id auto
        return from(setDoc(newRef, data));
      }).pipe(
        map(() => void 0),
        catchError((err) => this.firestoreError.handleFirestoreError(err, { context, silent }))
      );
    }, context, silent);
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

      return defer(() => {
        // ✅ aqui é o melhor lugar: roda só quando for escrever de fato
        if (
          environment.enableDebugTools &&
          !environment.production &&
          col === 'users' &&
          merge === true
        ) {
          console.warn('[WRITE users merge:true]', { docId: id, context });
          console.trace();
        }

        return from(setDoc(doc(this.db, col, id), data, { merge }));
      }).pipe(
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

      return defer(() => from(updateDoc(doc(this.db, col, id), data))).pipe(
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

      return defer(() => from(deleteDoc(doc(this.db, col, id)))).pipe(
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

      return defer(() =>
        from(updateDoc(doc(this.db, col, id), { [field]: increment(incBy) }))
      ).pipe(
        map(() => void 0),
        catchError((err) => this.firestoreError.handleFirestoreError(err, { context, silent }))
      );
    }, context, silent);
  }
}//Linha 196
