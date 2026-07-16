import {
  EnvironmentInjector,
  Injectable,
  inject,
  runInInjectionContext,
} from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, from, throwError } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay } from 'rxjs/operators';

import {
  IUserAgeReverification,
} from 'src/app/core/interfaces/iuser-dados';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { toErrorInstance } from 'src/app/core/utils/firebase-error-utils';
import { normalizeAgeReverificationStatus } from 'src/app/core/guards/compliance/age-reverification-status.util';

export interface SubmitAgeReverificationInput {
  birthDate: string;
  confirmsTruthfulness: boolean;
  acceptsRestrictedProcessing: boolean;
}

interface SubmitAgeReverificationResponse {
  caseId: string;
  status: 'SUBMITTED';
}

@Injectable({ providedIn: 'root' })
export class AgeReverificationService {
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly currentUser = inject(CurrentUserStoreService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  readonly currentState$: Observable<IUserAgeReverification | null> =
    this.currentUser.user$.pipe(
      map((user) => user?.ageReverification ?? null),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  submitCurrent$(
    input: SubmitAgeReverificationInput
  ): Observable<SubmitAgeReverificationResponse> {
    const normalized = this.normalizeInput(input);

    if (!normalized) {
      return throwError(
        () => new Error('Preencha a data e as confirmações obrigatórias.')
      );
    }

    const callable = this.createSubmitCallable();

    return from(callable(normalized)).pipe(
      map((response) => response.data),
      catchError((error) => {
        this.reportError(error, 'submitCurrent');
        return throwError(() => error);
      })
    );
  }

  statusLabel(state: IUserAgeReverification | null | undefined): string {
    switch (normalizeAgeReverificationStatus(state?.status)) {
      case 'REQUIRED':
        return 'Aguardando seu envio';
      case 'SUBMITTED':
        return 'Enviado para análise';
      case 'UNDER_REVIEW':
        return 'Em análise';
      case 'VERIFIED':
        return 'Maioridade confirmada';
      case 'REJECTED':
        return 'Revalidação rejeitada';
      case 'EXPIRED':
        return 'Prazo expirado';
      default:
        return 'Sem revalidação pendente';
    }
  }

  private createSubmitCallable() {
    return runInInjectionContext(this.environmentInjector, () =>
      httpsCallable<
        SubmitAgeReverificationInput,
        SubmitAgeReverificationResponse
      >(
        inject(Functions),
        'submitProfileAgeReverification'
      )
    );
  }

  private normalizeInput(
    input: SubmitAgeReverificationInput
  ): SubmitAgeReverificationInput | null {
    const birthDate = String(input?.birthDate ?? '').trim();

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
      input?.confirmsTruthfulness !== true ||
      input?.acceptsRestrictedProcessing !== true
    ) {
      return null;
    }

    return {
      birthDate,
      confirmsTruthfulness: true,
      acceptsRestrictedProcessing: true,
    };
  }

  private reportError(error: unknown, operation: string): void {
    try {
      const normalizedError = toErrorInstance(
        error,
        `[AgeReverificationService.${operation}] falhou.`
      );

      (normalizedError as any).feature = 'age_reverification';
      (normalizedError as any).operation = operation;
      (normalizedError as any).original = error;
      this.globalError.handleError(normalizedError);
    } catch {
      // noop
    }
  }
}
