import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ApplicationErrorService } from '../error-handler/application-error.service';
import {
  type AdminUserRow,
  parseAdminUserDetailResponse,
} from './admin-users-page.model';

@Injectable({ providedIn: 'root' })
export class AdminUserDetailService {
  private readonly functions = inject(Functions);
  private readonly errors = inject(ApplicationErrorService);

  private readonly callable = httpsCallable<
    { uid: string },
    unknown
  >(this.functions, 'getAdminUserDetail');

  getAdminUserDetail$(uid: string): Observable<AdminUserRow | null> {
    return defer(() => {
      if (
        typeof uid !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(uid)
      ) {
        throw new Error('Invalid administrative UID.');
      }

      return from(this.callable({ uid })).pipe(
        map(response =>
          parseAdminUserDetailResponse(response.data)
        )
      );
    }).pipe(
      catchError(error => {
        try {
          this.errors.report(error, {
            feature: 'admin-users',
            operation: 'getAdminUserDetail',
            fallbackMessage:
              'Falha ao consultar detalhes administrativos.',
            presentation: {
              surface: 'none',
              severity: 'error',
            },
            metadata: {
              scope: 'AdminUserDetailService',
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
