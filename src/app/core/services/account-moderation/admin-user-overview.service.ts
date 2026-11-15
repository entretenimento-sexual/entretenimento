import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ApplicationErrorService } from
  'src/app/core/services/error-handler/application-error.service';

import {
  AdminUserOverview,
  parseAdminUserOverview,
} from './admin-user-overview.model';

@Injectable({ providedIn: 'root' })
export class AdminUserOverviewService {
  private readonly functions = inject(Functions);
  private readonly applicationError = inject(ApplicationErrorService);

  private readonly callable = httpsCallable<
    Record<string, never>,
    unknown
  >(this.functions, 'getAdminUserOverview');

  getAdminUserOverview$(): Observable<AdminUserOverview> {
    return defer(() => from(this.callable({}))).pipe(
      map(response => parseAdminUserOverview(response.data)),
      catchError(error => {
        try {
          this.applicationError.report(error, {
            feature: 'admin-operational-overview',
            operation: 'getAdminUserOverview',
            fallbackMessage:
              'Falha ao carregar indicadores administrativos.',
            presentation: {
              surface: 'none',
              severity: 'error',
            },
            metadata: {
              scope: 'AdminUserOverviewService',
            },
          });
        } catch {
          // Preserve the original error.
        }

        return throwError(() => error);
      })
    );
  }
}
