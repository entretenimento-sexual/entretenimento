//src\app\core\services\autentication\auth\age-verification.service.ts
import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, take } from 'rxjs/operators';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { FirestoreWriteService } from '@core/services/data-handling/firestore/core/firestore-write.service';
import { CurrentUserStoreService } from './current-user-store.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { environment } from 'src/environments/environment';

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

export interface SubmitAgeDeclarationPayload {
  uid: string;
  declaredBirthDate: string; // YYYY-MM-DD
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
    private readonly write: FirestoreWriteService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly notify: ErrorNotificationService,
  ) {}

  /**
   * Fonte reativa do bloco ageVerification no runtime atual.
   *
   * Regras:
   * - undefined/null/user sem bloco => unknown
   * - nunca lança erro para a UI
   */
  readonly ageVerification$: Observable<IUserAgeVerification> = this.currentUserStore.user$.pipe(
    map((user) => this.extractAgeVerification(user))
  );

  /**
   * Fonte reativa da elegibilidade etária para gates.
   */
  readonly eligibility$: Observable<AgeEligibilityResult> = this.ageVerification$.pipe(
    map((age) => this.toEligibility(age))
  );

  /**
   * API de submissão da declaração etária.
   *
   * Fluxo:
   * - valida formato da data
   * - calcula idade localmente
   * - persiste status materializado em users/{uid}
   * - atualiza runtime com patch leve
   *
   * Observação:
   * - para a fase atual do projeto, isso já funciona bem
   * - no futuro, a decisão pode migrar para Cloud Function / revisão
   */
  submitAgeDeclaration$(
    payload: SubmitAgeDeclarationPayload
  ): Observable<AgeEligibilityResult> {
    const uid = (payload?.uid ?? '').trim();
    const declaredBirthDate = (payload?.declaredBirthDate ?? '').trim();
    const declaredAdult = payload?.declaredAdult === true;

    if (!uid) {
      return this.fail$('submitAgeDeclaration$', 'Sessão inválida para validar idade.');
    }

    if (!this.isValidIsoDate(declaredBirthDate)) {
      return this.fail$('submitAgeDeclaration$', 'Data de nascimento inválida.');
    }

    const evaluated = this.evaluateBirthDate(declaredBirthDate, declaredAdult);
    const patch = {
      ageVerification: {
        declaredBirthDate,
        declaredAdult,
        status: evaluated.status,
        checkedAt: Date.now(),
        reason: evaluated.reason ?? '',
      },
      updatedAtMs: Date.now(),
    };

    return this.write.updateDocument('users', uid, patch, {
      context: 'AgeVerificationService.submitAgeDeclaration',
    }).pipe(
      map(() => {
        this.currentUserStore.patch({
          ageVerification: {
            declaredBirthDate,
            declaredAdult,
            status: evaluated.status,
            checkedAt: patch.ageVerification.checkedAt,
            reason: evaluated.reason,
          },
        } as Partial<IUserDados>);

        return evaluated;
      }),
      catchError((err) => {
        this.reportSilent(err, {
          phase: 'submitAgeDeclaration',
          uid,
          declaredBirthDate,
        });

        this.notify.showError('Não foi possível validar a idade agora. Tente novamente.');
        return throwError(() => err);
      })
    );
  }

  /**
   * Snapshot único da elegibilidade atual.
   * Útil para submit handlers e guards específicos.
   */
  getEligibilityOnce$(): Observable<AgeEligibilityResult> {
    return this.eligibility$.pipe(take(1));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private extractAgeVerification(user: IUserDados | null | undefined): IUserAgeVerification {
    const raw = (user as any)?.ageVerification as IUserAgeVerification | undefined;

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
          isEligible: true,
          isResolved: true,
          reason: age?.reason,
        };

      case 'rejected-minor':
        return {
          status: 'rejected-minor',
          isEligible: false,
          isResolved: true,
          reason: age?.reason ?? 'Perfil incompatível com a política etária.',
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

  /**
   * Regra inicial de maioridade:
   * - calcula idade localmente
   * - < 18 => rejected-minor
   * - >= 18 e declarou adulto => verified-adult
   * - >= 18 mas não declarou adulto => needs-review
   *
   * Observação:
   * - isso é regra de projeto
   * - não substitui revisão documental futura
   */
  private evaluateBirthDate(
    declaredBirthDate: string,
    declaredAdult: boolean
  ): AgeEligibilityResult {
    const ageInYears = this.calculateAgeInYears(declaredBirthDate);

    if (ageInYears === null) {
      return {
        status: 'needs-review',
        isEligible: false,
        isResolved: true,
        reason: 'Não foi possível calcular a idade declarada.',
      };
    }

    if (ageInYears < 18) {
      return {
        status: 'rejected-minor',
        isEligible: false,
        isResolved: true,
        reason: 'Cadastro incompatível com a idade mínima da plataforma.',
      };
    }

    if (!declaredAdult) {
      return {
        status: 'needs-review',
        isEligible: false,
        isResolved: true,
        reason: 'Confirmação de maioridade não concluída.',
      };
    }

    return {
      status: 'verified-adult',
      isEligible: true,
      isResolved: true,
      reason: 'Maioridade declarada e validada no fluxo atual.',
    };
  }

  private calculateAgeInYears(isoDate: string): number | null {
    if (!this.isValidIsoDate(isoDate)) return null;

    const today = new Date();
    const birth = new Date(`${isoDate}T00:00:00`);

    if (Number.isNaN(birth.getTime())) return null;

    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    const dayDiff = today.getDate() - birth.getDate();

    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      age--;
    }

    return age >= 0 ? age : null;
  }

  private isValidIsoDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test((value ?? '').trim());
  }

  private normalizeStatus(value: unknown): AgeVerificationStatus {
    return value === 'pending' ||
      value === 'verified-adult' ||
      value === 'rejected-minor' ||
      value === 'needs-review'
      ? value
      : 'unknown';
  }

  private fail$<T = never>(context: string, message: string): Observable<T> {
    const err = new Error(message);
    this.reportSilent(err, { phase: context });
    return throwError(() => err);
  }

  private reportSilent(err: unknown, context: Record<string, unknown>): void {
    try {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.log('[AgeVerificationService]', context, err);
      }

      const error = new Error('[AgeVerificationService] operation failed');
      (error as any).silent = true;
      (error as any).skipUserNotification = true;
      (error as any).original = err;
      (error as any).context = context;

      this.globalErrorHandler.handleError(error);
    } catch {
      // noop
    }
  }
}
