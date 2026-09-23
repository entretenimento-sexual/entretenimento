// src/app/core/services/autentication/auth/age-verification.service.ts
// -----------------------------------------------------------------------------
// LEGACY AGE VERIFICATION COMPATIBILITY
// -----------------------------------------------------------------------------
// ageVerification foi client-authoritative e não pode mais produzir autorização.
// A leitura permanece temporariamente para compatibilidade/migração, sempre
// fail-closed. A autoridade etária canônica será backend-only.
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { map, take } from 'rxjs/operators';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { environment } from 'src/environments/environment';
import { CurrentUserStoreService } from './current-user-store.service';

type AgeVerificationStatus =
  | 'unknown'
  | 'pending'
  | 'verified-adult'
  | 'rejected-minor'
  | 'needs-review';

interface IUserAgeVerification {
  declaredBirthDate?: string;
  declaredAdult?: boolean;
  status: AgeVerificationStatus;
  checkedAt?: number;
  reason?: string;
}

type LegacyAgeVerificationCarrier = IUserDados & {
  ageVerification?: IUserAgeVerification | null;
};

export interface SubmitAgeDeclarationPayload {
  uid: string;
  declaredBirthDate: string;
  declaredAdult: boolean;
}

export interface AgeEligibilityResult {
  status: AgeVerificationStatus;
  isEligible: boolean;
  isResolved: boolean;
  reason?: string;
}

@Injectable({ providedIn: 'root' })
export class AgeVerificationService {
  private readonly debug = !environment.production;

  constructor(
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly applicationError: ApplicationErrorService,
  ) {}

  /**
   * Compatibilidade somente-leitura do campo legado.
   *
   * Importante: nenhum valor lido daqui constitui prova de maioridade.
   */
  readonly ageVerification$: Observable<IUserAgeVerification> =
    this.currentUserStore.user$.pipe(
      map((user) => this.extractAgeVerification(user))
    );

  /**
   * Compatibilidade reativa fail-closed.
   *
   * Mesmo um antigo "verified-adult" nunca libera acesso. Consumidores ainda
   * ligados a este serviço permanecerão bloqueados até migrarem para a futura
   * autoridade backend-only.
   */
  readonly eligibility$: Observable<AgeEligibilityResult> =
    this.ageVerification$.pipe(
      map((age) => this.toEligibility(age))
    );

  /**
   * A escrita client-authoritative foi desativada por segurança.
   *
   * Mantemos a assinatura temporariamente para evitar quebra estrutural durante
   * a migração. Nenhum dado é persistido e nenhum runtime é materializado.
   */
  submitAgeDeclaration$(
    payload: SubmitAgeDeclarationPayload
  ): Observable<AgeEligibilityResult> {
    const uid = String(payload?.uid ?? '').trim();
    const declaredBirthDate = String(payload?.declaredBirthDate ?? '').trim();

    if (!uid) {
      return this.fail$(
        'submitAgeDeclaration$',
        'Sessão inválida para validar idade.'
      );
    }

    if (!this.isValidIsoDate(declaredBirthDate)) {
      return this.fail$(
        'submitAgeDeclaration$',
        'Data de nascimento inválida.'
      );
    }

    return this.fail$(
      'submitAgeDeclaration$',
      'A verificação etária legada foi desativada. Use o fluxo de verificação de maioridade da plataforma.'
    );
  }

  getEligibilityOnce$(): Observable<AgeEligibilityResult> {
    return this.eligibility$.pipe(take(1));
  }

  private extractAgeVerification(
    user: IUserDados | null | undefined
  ): IUserAgeVerification {
    const raw = (user as LegacyAgeVerificationCarrier | null | undefined)
      ?.ageVerification;

    return {
      declaredBirthDate: raw?.declaredBirthDate,
      declaredAdult: raw?.declaredAdult,
      status: this.normalizeStatus(raw?.status),
      checkedAt: raw?.checkedAt,
      reason: raw?.reason,
    };
  }

  private toEligibility(age: IUserAgeVerification): AgeEligibilityResult {
    switch (this.normalizeStatus(age?.status)) {
      case 'verified-adult':
        return {
          status: 'verified-adult',
          isEligible: false,
          isResolved: false,
          reason:
            'A verificação etária legada não é fonte válida de autorização.',
        };

      case 'rejected-minor':
        return {
          status: 'rejected-minor',
          isEligible: false,
          isResolved: true,
          reason:
            age?.reason ?? 'Perfil incompatível com a política etária.',
        };

      case 'needs-review':
        return {
          status: 'needs-review',
          isEligible: false,
          isResolved: true,
          reason: age?.reason ?? 'Perfil em revisão etária.',
        };

      case 'pending':
        return {
          status: 'pending',
          isEligible: false,
          isResolved: false,
          reason: age?.reason,
        };

      case 'unknown':
      default:
        return {
          status: 'unknown',
          isEligible: false,
          isResolved: false,
          reason: age?.reason,
        };
    }
  }

  private isValidIsoDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());
  }

  private normalizeStatus(value: unknown): AgeVerificationStatus {
    return value === 'pending' ||
      value === 'verified-adult' ||
      value === 'rejected-minor' ||
      value === 'needs-review'
      ? value
      : 'unknown';
  }

  private fail$<T = never>(
    context: string,
    message: string
  ): Observable<T> {
    const error = new Error(message);
    this.reportSilent(error, { phase: context });
    return throwError(() => error);
  }

  private reportSilent(
    error: unknown,
    context: Record<string, unknown>
  ): void {
    this.reportError(error, context, {
      fallbackMessage:
        'Não foi possível concluir uma etapa interna da validação de idade.',
      presentation: { surface: 'none', severity: 'error' },
    });
  }

  private reportError(
    error: unknown,
    context: Record<string, unknown>,
    options: {
      fallbackMessage: string;
      presentation: { surface: 'none'; severity: 'error' };
    }
  ): void {
    try {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.log('[AgeVerificationService]', context, error);
      }

      const operation =
        typeof context['phase'] === 'string' && context['phase'].trim()
          ? context['phase'].trim()
          : 'internal';

      this.applicationError.report(error, {
        feature: 'age-verification',
        operation,
        fallbackMessage: options.fallbackMessage,
        presentation: options.presentation,
        metadata: {
          scope: 'AgeVerificationService',
          ...context,
        },
      });
    } catch {
      // Diagnóstico secundário nunca altera a fronteira etária.
    }
  }
}
