// src/app/core/services/data-handling/firestore/repositories/public-index.repository.ts
// Não esqueça os comentários
import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';

import { arrayUnion, doc, runTransaction, Timestamp, } from 'firebase/firestore';
import { NicknameUtils } from '@core/utils/nickname-utils';

import { FirestoreReadService } from '../core/firestore-read.service';
import { FirestoreWriteService } from '../core/firestore-write.service';
import { FirestoreErrorHandlerService } from '../../../error-handler/firestore-error-handler.service';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';

type DomainError = Error & { code?: string };
type PublicIndexNicknameDoc = {
  type: 'nickname';
  value: string;
  uid: string;
  createdAt: any;      // Timestamp
  lastChangedAt: any;  // Timestamp
};

@Injectable({ providedIn: 'root' })
export class PublicIndexRepository {
  constructor(
    private readonly read: FirestoreReadService,
    private readonly write: FirestoreWriteService,
    private readonly firestoreError: FirestoreErrorHandlerService,
    private readonly auth: Auth,
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService
  ) { }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private normalizeNickname(nickname: string): string {
    /**
     * Normalização para KEY/índice.
     * Mantemos aqui o método (nomenclatura original), mas a regra fica centralizada.
     */
    return NicknameUtils.normalizarApelidoParaIndice(nickname);
  }


  private nicknameDocId(normalizedNickname: string): string {
    return `nickname:${normalizedNickname}`;
  }

  private domainError(message: string, code: string): DomainError {
    const e: DomainError = new Error(message);
    e.code = code;
    return e;
  }

  // --------------------------------------------------------------------------
  // API pública (mantém nomenclaturas originais)
  // --------------------------------------------------------------------------

  getPublicNicknameIndex(nickname: string): Observable<any | null> {
    const normalized = this.normalizeNickname(nickname);
    if (!normalized) return of(null);

    const docId = this.nicknameDocId(normalized);
    return this.read.getDocument<any>('public_index', docId, { source: 'server' });
  }

  savePublicIndexNickname(nickname: string): Observable<void> {
    const normalized = this.normalizeNickname(nickname);
    const user = this.auth.currentUser;

    if (!user) {
      return throwError(() =>
        Object.assign(new Error('Usuário não autenticado.'), { code: 'auth/not-authenticated' })
      );
    }

    const docId = this.nicknameDocId(normalized);
    const data = {
      type: 'nickname',
      value: normalized,
      uid: user.uid,
      createdAt: Timestamp.now(),
      lastChangedAt: Timestamp.now(),
    };

    // ✅ create-only via rules (update bloqueado)
    return this.write.setDocument('public_index', docId, data).pipe(
      catchError((err) => this.mapNicknameCreateOnlyError(err, docId))
    );
  }

  /**
   * ========================================================================
   * UPDATE NICKNAME (plataforma grande)
   * - 100% ATÔMICO via Firestore transaction:
   *   cria novo índice + atualiza users + atualiza public_profiles + deleta antigo
   * - Sem rollback manual (transação é all-or-nothing).
   * - Mantém Observables.
   * ========================================================================
   */
  updatePublicNickname(oldNickname: string, newNickname: string, isSubscriber: boolean): Observable<void> {
    const user = this.auth.currentUser;

    if (!user) {
      return throwError(() =>
        Object.assign(new Error('Usuário não autenticado.'), { code: 'auth/not-authenticated' })
      );
    }

    if (!isSubscriber) {
      return throwError(() =>
        Object.assign(new Error('Mudança de apelido restrita a assinantes.'), { code: 'subscription/required' })
      );
    }

    const oldN = this.normalizeNickname(oldNickname);
    const newN = this.normalizeNickname(newNickname);

    if (!newN) {
      return throwError(() => this.domainError('Novo apelido inválido.', 'nickname/invalid'));
    }

    // idempotente: se o normalized é o mesmo, não faz nada
    if (oldN && oldN === newN) return of(void 0);

    const oldDocId = oldN ? this.nicknameDocId(oldN) : null;
    const newDocId = this.nicknameDocId(newN);

    const nowTs = Timestamp.now();
    const nowMs = Date.now();

    return this.ctx.deferPromise$(() =>
      runTransaction(this.db as any, async (tx) => {
        // refs
        const newIndexRef = doc(this.db as any, 'public_index', newDocId);
        const oldIndexRef = oldDocId ? doc(this.db as any, 'public_index', oldDocId) : null;

        const userRef = doc(this.db as any, 'users', user.uid);
        const publicProfileRef = doc(this.db as any, 'public_profiles', user.uid);

        // 1) novo índice já existe?
        const newIdxSnap = await tx.get(newIndexRef);
        if (newIdxSnap.exists()) {
          throw this.domainError('Apelido já está em uso.', 'nickname/in-use');
        }

        // 2) se houver oldDocId, valida propriedade (best-effort)
        if (oldIndexRef) {
          const oldIdxSnap = await tx.get(oldIndexRef);
          if (oldIdxSnap.exists()) {
            const oldData = oldIdxSnap.data() as Partial<PublicIndexNicknameDoc> | undefined;
            const oldOwner = oldData?.uid;

            if (oldOwner && oldOwner !== user.uid) {
              throw this.domainError('Apelido antigo não pertence ao usuário.', 'nickname/old-not-owned');
            }
          }
          // se não existir, seguimos: isso cobre contas antigas sem índice ou inconsistência histórica
        }

        // 3) cria novo índice (create-only)
        tx.set(newIndexRef, {
          type: 'nickname',
          value: newN,
          uid: user.uid,
          createdAt: nowTs,
          lastChangedAt: nowTs,
        });

        // 4) atualiza users/{uid}
        // - nickname: formato “display”
        // - nicknameNormalized: útil p/ busca e consistência (opcional)
        // - nicknameHistory: auditoria leve (opcional)
        tx.set(
          userRef,
          {
            nickname: (newNickname ?? '').trim(),
            nicknameNormalized: newN,
            nicknameUpdatedAt: nowMs,
            nicknameHistory: arrayUnion({ nickname: newN, date: nowMs }),
          },
          { merge: true }
        );

        // 5) upsert em public_profiles/{uid}
        const profileSnap = await tx.get(publicProfileRef);
        if (!profileSnap.exists()) {
          // create: cria doc público mínimo (você pode enriquecer depois)
          tx.set(publicProfileRef, {
            uid: user.uid,
            nickname: (newNickname ?? '').trim(),
            nicknameNormalized: newN,
            createdAt: nowTs,
            updatedAt: nowTs,
          });
        } else {
          // update: não altera createdAt
          tx.set(
            publicProfileRef,
            {
              nickname: (newNickname ?? '').trim(),
              nicknameNormalized: newN,
              updatedAt: nowTs,
            },
            { merge: true }
          );
        }

        // 6) apaga índice antigo (se existir)
        if (oldIndexRef) {
          const oldIdxSnap2 = await tx.get(oldIndexRef);
          if (oldIdxSnap2.exists()) {
            tx.delete(oldIndexRef);
          }
        }
      })
    ).pipe(
      map(() => void 0),
      catchError((err: any) => {
        // erros de domínio seguem pra UI
        if (err?.code === 'nickname/in-use' || err?.code?.startsWith?.('nickname/')) {
          return throwError(() => err);
        }
        // o resto vai pro handler central
        return this.firestoreError.handleFirestoreError(err);
      })
    );
  }

  /**
   * Mantido: útil pro create-only fora de transaction (ex.: registro)
   */
  private mapNicknameCreateOnlyError(err: any, docId: string): Observable<never> {
    const code = err?.code ?? err?.name ?? '';

    const maybeConflict =
      code === 'permission-denied' ||
      code === 'PERMISSION_DENIED' ||
      String(code).includes('permission');

    if (!maybeConflict) {
      return this.firestoreError.handleFirestoreError(err);
    }

    return this.read.getDocument<any>('public_index', docId, { source: 'server' }).pipe(
      take(1),
      switchMap((doc) => {
        if (doc) {
          return throwError(() =>
            Object.assign(new Error('Apelido já está em uso.'), { code: 'nickname/in-use' })
          );
        }
        return this.firestoreError.handleFirestoreError(err);
      })
    );
  }
} //263 linhas

/*
- Usuário digita o apelido (principal + complemento) no /register.
- O app normaliza o texto (trim + lower + colapsa espaços) e monta o docId do índice:
public_index / nickname:<normalized>.
- O FirestoreValidationService.checkIfNicknameExists() faz GET 1x nesse doc:
  * soft (UX / blur): pode usar cache e getDoc (default). Se falhar rede, não trava e retorna false.
  * strict (submit): força getDocFromServer. Se falhar, propaga erro (não assume “livre”).
- Se o doc existe ⇒ retorna true ⇒ o form marca erro apelidoEmUso e bloqueia o cadastro.
- Mesmo assim, a proteção final é a transaction do registro: ela tenta tx.get(indexRef) e, se existir, aborta (garantia anti-duplicidade no backend).
*/

/*
Observação importante (não é do patch, mas impacta rules)
No PublicIndexRepository, você usa Timestamp.now() em createdAt/lastChangedAt.
Se suas rules realmente exigem serverTimestamp() == request.time, isso vai negar writes fora do RegisterService (que usa serverTimestamp()).
Quando formos mexer nessa parte (update nickname), o ajuste correto é trocar esses Timestamp.now() por serverTimestamp() (e, se precisar, adequar o tipo/serialização no seu FirestoreWriteService).
*/
