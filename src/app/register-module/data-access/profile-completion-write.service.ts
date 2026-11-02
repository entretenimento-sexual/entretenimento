// src/app/register-module/data-access/profile-completion-write.service.ts
import { EnvironmentInjector, Injectable, Optional, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore } from '@angular/fire/firestore';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import {
  PROFILE_IDENTITY_CATALOG_VERSION,
  isSelectableProfileIdentityCode,
} from 'src/app/core/domain/profile-identity/profile-identity.catalog';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { NicknameUtils } from 'src/app/core/utils/nickname-utils';

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
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    @Optional() private readonly functions?: Functions,
    @Optional() private readonly injector?: EnvironmentInjector
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

    return this.ctx
      .deferPromise$(() => {
        // DB remains injected for compatibility; all registration writes
        // are now performed with Admin SDK in a single backend transaction.
        void this.db;
        if (!this.functions || !this.injector) {
          throw this.createError('registration/backend-unavailable',
            'Conclusão de cadastro indisponível.');
        }
        const callable = runInInjectionContext(this.injector, () =>
          httpsCallable<AtomicProfileCompletionInput, { status: 'COMPLETED' }>(
            this.functions!, 'completeRegistrationProfile'
          )
        );
        return callable({ uid, nickname, gender, orientation, estado, municipio });
      })
      .pipe(
        map(() => void 0),
        catchError((error) => {
          this.reportError(error, uid, nicknameNormalized);
          return throwError(() => error);
        })
      );
  }

  private validateRequiredProfileFields(input: {
    gender: string;
    orientation: string;
    estado: string;
    municipio: string;
  }): Error | null {
    if (!isSelectableProfileIdentityCode(input.gender)) {
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
