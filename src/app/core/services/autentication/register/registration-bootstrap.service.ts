// src/app/core/services/autentication/register/registration-bootstrap.service.ts
// =============================================================================
// REGISTRATION BOOTSTRAP SERVICE
// =============================================================================
// Fonte canônica para o nascimento do documento privado da conta.
//
// Privacidade por padrão:
// - o cadastro inicial NÃO cria public_profiles/{uid};
// - a projeção pública nasce atomicamente apenas em ProfileCompletionWriteService;
// - o perfil não fica consultável antes de e-mail/termos/consentimento/onboarding;
// - a reserva de nickname permanece no public_index durante esta migração.
// =============================================================================
import { EnvironmentInjector, Injectable, Optional, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Auth } from '@angular/fire/auth';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { RegistrationRecoveryService } from './registration-recovery.service';
import { IUserDados } from '@core/interfaces/iuser-dados';
import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { ApplicationErrorService } from '../../error-handler/application-error.service';
import { FirestoreContextService } from '../../data-handling/firestore/core/firestore-context.service';
import { NicknameUtils } from '@core/utils/nickname-utils';

export interface EmailPasswordRegistrationBootstrapInput {
  uid: string;
  userData: IUserRegistrationData;
  traceId?: string;
}

export interface SocialRegistrationBootstrapInput {
  uid: string;
}

@Injectable({ providedIn: 'root' })
export class RegistrationBootstrapService {
  private readonly NICKNAME_NORM_RE = /^[a-z0-9._-]{3,40}$/;
  private readonly diagnosedErrors = new WeakSet<object>();

  constructor(
    private readonly auth: Auth,
    private readonly ctx: FirestoreContextService,
    private readonly recovery: RegistrationRecoveryService,
    private readonly applicationError: ApplicationErrorService,
    @Optional() private readonly functions?: Functions,
    @Optional() private readonly injector?: EnvironmentInjector
  ) {}

  createEmailPasswordSeed$(
    input: EmailPasswordRegistrationBootstrapInput
  ): Observable<void> {
    const uid = this.cleanText(input.uid);
    const nickname = this.cleanText(input.userData?.nickname);
    const normalized = this.normalizeNickname(nickname);
    if (!uid) {
      return throwError(
        () => new Error('[RegistrationBootstrapService] UID inválido.')
      );
    }

    if (!nickname || !this.NICKNAME_NORM_RE.test(normalized)) {
      return throwError(
        () => new Error('[RegistrationBootstrapService] Apelido inválido.')
      );
    }

    // A reserva é transacional no backend: o cliente envia o apelido e o UID esperado.
    // Não gravar public_index ou nicknameHistory a partir do SDK do navegador.
    return this.ctx
      .deferPromise$(() => {
        this.assertActiveUid(uid);
        if (!this.functions || !this.injector) {
          throw new Error('Serviço de reserva de nickname indisponível.');
        }
        const callable = runInInjectionContext(this.injector, () =>
          httpsCallable<{ nickname: string; expectedUid: string }, { nickname: string; normalized: string }>(
            this.functions!, 'reserveRegistrationNickname'
          )
        );
        return callable({ nickname, expectedUid: uid });
      })
      .pipe(
        map(({ data }) => {
          this.assertActiveUid(uid);
          if (data?.normalized !== normalized) {
            throw new Error('A reserva do apelido não foi confirmada.');
          }
        }),
        catchError((error) => {
          this.reportOperationalError(error, 'createEmailPasswordSeed', {
            uid, traceId: input.traceId ?? null,
            nicknamePresent: !!nickname, normalizedLength: normalized.length,
          });
          return throwError(() => error);
        })
      );
  }

  createSocialSeed$(
    input: SocialRegistrationBootstrapInput
  ): Observable<{ user: IUserDados; created: boolean }> {
    const uid = this.cleanText(input.uid);
    if (!uid) {
      return throwError(() => new Error('[RegistrationBootstrapService] UID inválido.'));
    }

    return this.recovery.recoverForUser$(uid, { hydrate: false }).pipe(
      map(({ user, created }) => ({ user, created })),
      catchError((error) => {
        // recoverForUser$ já diagnosticou a falha operacional.
        this.markDiagnosticOwnership(error);
        return throwError(() => error);
      })
    );
  }

  private assertActiveUid(uid: string): void {
    if (this.auth.currentUser?.uid !== uid) {
      throw new Error('A conta ativa mudou durante o cadastro.');
    }
  }

  private normalizeNickname(nickname: string): string {
    return NicknameUtils.normalizarApelidoParaIndice(nickname);
  }

  private cleanText(value: unknown): string {
    return String(value ?? '').trim();
  }

  /**
   * Informa aos consumidores se esta instância já assumiu o diagnóstico técnico
   * do mesmo objeto de erro. O WeakSet evita mutar erros de Firebase/Firestore.
   */
  hasDiagnosticOwnership(error: unknown): boolean {
    return this.isTrackableError(error)
      && this.diagnosedErrors.has(error as object);
  }

  private reportOperationalError(
    error: unknown,
    operation: 'createEmailPasswordSeed' | 'createSocialSeed',
    metadata: Record<string, unknown>
  ): void {
    if (this.hasDiagnosticOwnership(error)) {
      return;
    }

    try {
      this.applicationError.report(error, {
        feature: 'registration-bootstrap',
        operation,
        fallbackMessage:
          'Não foi possível concluir a preparação inicial da conta.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'RegistrationBootstrapService',
          ...metadata,
        },
      });

      this.markDiagnosticOwnership(error);
    } catch {
      // O consumidor poderá assumir o fallback sem alterar o erro público.
    }
  }

  private markDiagnosticOwnership(error: unknown): void {
    if (this.isTrackableError(error)) {
      this.diagnosedErrors.add(error as object);
    }
  }

  private isTrackableError(error: unknown): boolean {
    return (
      (typeof error === 'object' && error !== null) ||
      typeof error === 'function'
    );
  }
}
