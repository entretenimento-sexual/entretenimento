import { EnvironmentInjector, Injectable, inject, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { EMPTY, Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';

export interface IdentityChangeStatus {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED' | null;
  requestedIdentityCode: string | null;
}

/**
 * O formulário comum nunca escreve identidade. A alteração individual é
 * aplicada em transação pelo backend, sem depender de análise humana.
 */
@Injectable({ providedIn: 'root' })
export class ProfileIdentityChangeService {
  private readonly injector = inject(EnvironmentInjector);
  private readonly applicationError = inject(ApplicationErrorService);

  getStatus$(): Observable<IdentityChangeStatus | null> {
    const callable = runInInjectionContext(this.injector, () =>
      httpsCallable<Record<string, never>, IdentityChangeStatus>(
        inject(Functions), 'getMyProfileIdentityChange'
      )
    );
    return from(callable({})).pipe(
      map((response) => response.data),
      catchError((error) => {
        this.report(error, 'getStatus', 'Não foi possível consultar a solicitação.');
        return of(null);
      })
    );
  }

  requestChange$(identityCode: string): Observable<IdentityChangeStatus> {
    const callable = runInInjectionContext(this.injector, () =>
      httpsCallable<{ identityCode: string }, {
        status: 'APPROVED'; requestedIdentityCode: string;
      }>(inject(Functions), 'requestProfileIdentityChange')
    );
    return from(callable({ identityCode })).pipe(
      map((response) => response.data),
      catchError((error) => {
        this.report(error, 'requestChange', 'Não foi possível solicitar a alteração.');
        return EMPTY;
      })
    );
  }

  private report(error: unknown, operation: string, fallbackMessage: string): void {
    this.applicationError.report(error, {
      feature: 'profile-identity',
      operation: 'ProfileIdentityChangeService.' + operation,
      fallbackMessage,
      metadata: { scope: 'ProfileIdentityChangeService' },
    });
  }
}
