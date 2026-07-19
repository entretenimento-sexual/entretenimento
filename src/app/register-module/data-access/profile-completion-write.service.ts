// src/app/register-module/data-access/profile-completion-write.service.ts
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

const ALLOWED_GENDERS = new Set([
  'homem',
  'mulher',
  'casal-ele-ele',
  'casal-ele-ela',
  'casal-ela-ela',
  'travesti',
  'transexual',
  'crossdressers',
]);

const ALLOWED_ORIENTATIONS = new Set([
  'bissexual',
  'homossexual',
  'heterossexual',
  'pansexual',
]);

const BRAZILIAN_UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

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
    const nicknameNormalized =
      NicknameUtils.normalizarApelidoParaIndice(nickname);
    const gender = this.cleanText(input.gender).toLowerCase();
    const orientation = this.cleanText(input.orientation).toLowerCase();
    const estado = this.cleanText(input.estado).toUpperCase();
    const municipio = this.cleanText(input.municipio);

    if (!uid) {
      return throwError(() =>
        this.createError(
          'registration/invalid-uid',
          'UID inválido para conclusão do perfil.'
        )
      );
    }

    if (
      !NicknameUtils.isApelidoValido(nickname) ||
      !NicknameUtils.isApelidoIndiceValido(nickname)
    ) {
      return throwError(() =>
        this.createError(
          'nickname/invalid',
          'O apelido informado é inválido.'
        )
      );
    }

    const validationError = this.validateRequiredProfileFields({
      gender,
      orientation,
      estado,
      municipio,
    });
    if (validationError) return throwError(() => validationError);

    const userRef = this.ctx.run(() => doc(this.db, 'users', uid));
    const publicProfileRef = this.ctx.run(() =>
      doc(this.db, 'public_profiles', uid)
    );
    const nicknameIndexRef = this.ctx.run(() =>
      doc(this.db, 'public_index', `nickname:${nicknameNormalized}`)
    );

    return this.ctx
      .deferPromise$(() =>
        runTransaction(this.db as any, async (transaction) => {
          const [userSnapshot, publicProfileSnapshot, nicknameIndexSnapshot] =
            await Promise.all([
              transaction.get(userRef as any),
              transaction.get(publicProfileRef as any),
              transaction.get(nicknameIndexRef as any),
            ]);

          if (!userSnapshot.exists()) {
            throw this.createError(
              'registration/user-document-missing',
              'Os dados básicos da conta ainda não foram recuperados.'
            );
          }

          const userData = userSnapshot.data() as Record<string, unknown>;
          this.assertEligibleForPublicProfile(userData);

          const existingNickname = this.cleanText(userData['nickname']);
          const existingNormalized =
            NicknameUtils.normalizarApelidoParaIndice(existingNickname);

          if (
            existingNormalized &&
            existingNormalized !== nicknameNormalized
          ) {
            throw this.createError(
              'nickname/change-not-allowed',
              'O apelido existente não pode ser alterado nesta etapa.'
            );
          }

          if (nicknameIndexSnapshot.exists()) {
            const indexUid = this.cleanText(
              (nicknameIndexSnapshot.data() as Record<string, unknown>)['uid']
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
            gender,
            orientation,
            estado,
            municipio,
            profileCompleted: true,
            publicVisibility: 'visible',
            interactionBlocked: false,
            registrationCompletedAt: serverTimestamp(),
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
            gender,
            orientation: orientation || null,
            estado,
            municipio,
            updatedAt: serverTimestamp(),
          };

          if (!publicProfileSnapshot.exists()) {
            /**
             * A projeção pública não carrega entitlement. O papel inicial é
             * deliberadamente neutro; assinatura permanece no backend privado.
             */
            publicProfilePatch['role'] = 'free';
            publicProfilePatch['createdAt'] = serverTimestamp();
          }

          transaction.set(
            publicProfileRef as any,
            publicProfilePatch,
            { merge: true }
          );

          if (!nicknameIndexSnapshot.exists()) {
            transaction.set(nicknameIndexRef as any, {
              uid,
              type: 'nickname',
              value: nicknameNormalized,
              createdAt: serverTimestamp(),
              lastChangedAt: serverTimestamp(),
            });
          }
        })
      )
      .pipe(
        map(() => void 0),
        catchError((error) => {
          this.reportError(error, uid, nicknameNormalized);
          return throwError(() => error);
        })
      );
  }

  private assertEligibleForPublicProfile(
    userData: Record<string, unknown>
  ): void {
    const acceptedTerms = (userData['acceptedTerms'] ?? {}) as Record<
      string,
      unknown
    >;
    const adultConsent = (userData['adultConsent'] ?? {}) as Record<
      string,
      unknown
    >;
    const adultConsentRequired =
      userData['initialAdultConsentRequired'] !== false;

    if (userData['accountStatus'] !== 'active') {
      throw this.createError(
        'account/not-active',
        'A conta precisa estar ativa para publicar o perfil.'
      );
    }

    if (userData['emailVerified'] !== true) {
      throw this.createError(
        'registration/email-unverified',
        'Verifique o e-mail antes de concluir o perfil.'
      );
    }

    if (acceptedTerms['accepted'] !== true) {
      throw this.createError(
        'registration/terms-required',
        'Aceite os termos atuais antes de concluir o perfil.'
      );
    }

    if (
      adultConsentRequired &&
      adultConsent['accepted'] !== true
    ) {
      throw this.createError(
        'registration/adult-consent-required',
        'Confirme o acesso adulto antes de publicar o perfil.'
      );
    }
  }

  private validateRequiredProfileFields(input: {
    gender: string;
    orientation: string;
    estado: string;
    municipio: string;
  }): Error | null {
    if (!ALLOWED_GENDERS.has(input.gender)) {
      return this.createError(
        'profile/invalid-gender',
        'A identificação de perfil informada é inválida.'
      );
    }

    if (
      input.orientation &&
      !ALLOWED_ORIENTATIONS.has(input.orientation)
    ) {
      return this.createError(
        'profile/invalid-orientation',
        'A orientação informada é inválida.'
      );
    }

    if (!BRAZILIAN_UFS.has(input.estado)) {
      return this.createError(
        'profile/invalid-state',
        'O estado informado é inválido.'
      );
    }

    if (
      !input.municipio ||
      input.municipio.length > 120 ||
      /[\u0000-\u001F\u007F]/.test(input.municipio)
    ) {
      return this.createError(
        'profile/invalid-city',
        'O município informado é inválido.'
      );
    }

    return null;
  }

  private cleanText(value: unknown): string {
    return String(value ?? '').trim();
  }

  private createError(code: string, message: string): Error {
    const error = new Error(message) as Error & { code?: string };
    error.code = code;
    return error;
  }

  private reportError(
    error: unknown,
    uid: string,
    nicknameNormalized: string
  ): void {
    try {
      const normalized =
        error instanceof Error
          ? error
          : new Error('[ProfileCompletionWriteService] transaction failed');
      const contextual = normalized as Error & {
        context?: unknown;
        operation?: string;
        extra?: unknown;
        original?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = 'ProfileCompletionWriteService';
      contextual.operation = 'complete';
      contextual.extra = { uid, nicknameNormalized };
      contextual.original = error;
      contextual.skipUserNotification = true;
      this.globalErrorHandler.handleError(contextual);
    } catch {
      // Diagnóstico não interrompe o erro original.
    }
  }
}
