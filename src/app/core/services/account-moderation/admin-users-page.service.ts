import { Injectable, inject } from '@angular/core';
import {
  Functions,
  httpsCallable,
} from '@angular/fire/functions';
import {
  Observable,
  defer,
  from,
  throwError,
} from 'rxjs';
import {
  catchError,
  map,
} from 'rxjs/operators';

import {
  ApplicationErrorService,
} from '../error-handler/application-error.service';

import {
  normalizeAdminUsersPageRequest,
  parseAdminUsersPageResponse,
  type AdminUsersPageOptions,
  type AdminUsersPageRequest,
  type AdminUsersPageResponse,
} from './admin-users-page.model';

@Injectable({ providedIn: 'root' })
export class AdminUsersPageService {
  private readonly functions = inject(Functions);
  private readonly errors = inject(ApplicationErrorService);

  private readonly callable = httpsCallable<
    AdminUsersPageRequest,
    unknown
  >(
    this.functions,
    'getAdminUsersPage'
  );

  getAdminUsersPage$(
    options: AdminUsersPageOptions = {}
  ): Observable<AdminUsersPageResponse> {
    return defer(() => {
      const request = normalizeAdminUsersPageRequest(options);

      return from(this.callable(request)).pipe(
        map(response =>
          parseAdminUsersPageResponse(
            response.data,
            request.limit
          )
        )
      );
    }).pipe(
      catchError(error => {
        try {
          this.errors.report(error, {
            feature: 'admin-users',
            operation: 'getAdminUsersPage',
            fallbackMessage:
              'Falha ao consultar usuarios administrativos.',
            presentation: {
              surface: 'none',
              severity: 'error',
            },
            metadata: {
              scope: 'AdminUsersPageService',
              hasCursor: Boolean(options.cursor),
            },
          });
        } catch {
          // Error reporting must not replace the original error.
        }

        return throwError(() => error);
      })
    );
  }
}
