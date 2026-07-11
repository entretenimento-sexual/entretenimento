import { Injectable } from '@angular/core';
import { Firestore, doc } from '@angular/fire/firestore';

import {
  Timestamp,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { NicknameUtils } from 'src/app/core/utils/nickname-utils';

export interface AtomicProfileCompletionInput {
  uid: string;
  nickname: string;
  gender: string;
  orientation: string;
  estado: string;
  municipio: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileCompletionWriteService {
  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  complete$(input: AtomicProfileCompletionInput): Observable<void> {
    const uid = this.cleanText(input.uid);
    const nickname = NicknameUtils.normalizarApelido(input.nickname);
    const nicknameNormalized = NicknameUtils.normalizarApelidoParaIndice(nickname);

    if (!uid) {
      return throwError(() => this.createError(
        'registration/invalid-uid',
        'UID inválido para conclusão do perfil.'
      ));
    }

    if (
      !NicknameUtils.isApelidoValido(nickname) ||
      !NicknameUtils.isApelidoIndiceValido(nickname)
    ) {
      return throwError(() => this.createError(
        'nickname/invalid',
        'O apelido informado é inválido.'
      ));
    }

    const userRef = this.ctx.run(() => doc(this.db, 'users', uid));
    const publicProfileRef = this.ctx.run(() => doc(this.db, 'public_profiles', uid));
    const nicknameIndexRef = this.ctx.run(() =>
      doc(this.db, 'public_index', `nickname:${nicknameNormalized}`)
    );

    return this.ctx.deferPromise$(() =>
      runTransaction(this.db as any, async (transaction) => {
        const userSnap = await transaction.get(userRef as any);
        const publicProfileSnap = await transaction.get(publicProfileRef as any);
        const nicknameIndexSnap = await transaction.get(nicknameIndexRef as any);

        if (!userSnap.exists()) {
          throw this.createError(
            'registration/user-document-missing',
            'Os dados básicos da conta ainda não foram recuperados.'
          );
        }

        const userData = userSnap.data() as Record<string, unknown>;
        const existingNickname = this.cleanText(userData?.['nickname']);
        const existingNormalized = NicknameUtils.normalizarApelidoParaIndice(
          existingNickname
        );

        if (existingNormalized && existingNormalized !== nicknameNormalized) {
          throw this.createError(
            'nickname/change-not-allowed',
            'O apelido existente não pode ser alterado nesta etapa.'
          );
        }

        if (nicknameIndexSnap.exists()) {
          const indexUid = this.cleanText(
            (nicknameIndexSnap.data() as Record<string, unknown>)?.['uid']
          );

          if (indexUid !== uid) {
            throw this.createError(
              'nickname/in-use',
              'Este apelido já está em uso.'
            );
          }
        }

        const nowMs = Date.now();
        const userPatch: Record<string, unknown> = {
          uid,
          nickname,
          gender: this.cleanText(input.gender),
          orientation: this.cleanText(input.orientation),
          estado: this.cleanText(input.estado),
          municipio: this.cleanText(input.municipio),
          profileCompleted: true,
          updatedAt: serverTimestamp(),
          updatedAtMs: nowMs,
        };

        if (!existingNormalized) {
          userPatch['nicknameHistory'] = [
            {
              nickname: nicknameNormalized,
              date: Timestamp.fromMillis(nowMs),
            },
          ];
        }

        transaction.set(userRef as any, userPatch, { merge: true });

        const publicProfilePatch: Record<string, unknown> = {
          uid,
          nickname,
          nicknameNormalized,
          gender: this.cleanTextOrNull(input.gender),
          orientation: this.cleanTextOrNull(input.orientation),
          estado: this.cleanTextOrNull(input.estado),
          municipio: this.cleanTextOrNull(input.municipio),
          updatedAt: serverTimestamp(),
        };

        if (!publicProfileSnap.exists()) {
          publicProfilePatch['role'] = this.cleanText(userData?.['role']) || 'free';
          publicProfilePatch['createdAt'] = serverTimestamp();
        }

        transaction.set(
          publicProfileRef as any,
          publicProfilePatch,
          { merge: true }
        );

        if (!nicknameIndexSnap.exists()) {
          // O SDK web não possui transaction.create(). Como o documento foi lido
          // e confirmado ausente dentro desta mesma transação, set() mantém a
          // reserva atômica; as rules ainda exigem create-only e UID do próprio usuário.
          transaction.set(nicknameIndexRef as any, {
            uid,
            type: 'nickname',
            value: nicknameNormalized,
            createdAt: serverTimestamp(),
            lastChangedAt: serverTimestamp(),
          });
        }
      })
    ).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(error, uid, nicknameNormalized);
        return throwError(() => error);
      })
    );
  }

  private cleanText(value: unknown): string {
    return String(value ?? '').trim();
  }

  private cleanTextOrNull(value: unknown): string | null {
    const clean = this.cleanText(value);
    return clean || null;
  }

  private createError(code: string, message: string): Error {
    const error = new Error(message);
    (error as any).code = code;
    return error;
  }

  private reportError(
    error: unknown,
    uid: string,
    nicknameNormalized: string
  ): void {
    try {
      const err = error instanceof Error
        ? error
        : new Error('[ProfileCompletionWriteService] transaction failed');

      (err as any).context = 'ProfileCompletionWriteService';
      (err as any).operation = 'complete';
      (err as any).extra = { uid, nicknameNormalized };
      (err as any).original = error;
      (err as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(err);
    } catch {
      // noop
    }
  }
}
