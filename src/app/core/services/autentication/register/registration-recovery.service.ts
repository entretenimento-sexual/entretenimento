import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

import { Observable, defer, from, throwError } from 'rxjs';
import {
  catchError,
  map,
  switchMap,
  take,
  tap,
  timeout,
} from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FirestoreUserQueryService } from '../../data-handling/firestore-user-query.service';
import { ApplicationErrorService } from '../../error-handler/application-error.service';
import { AuthSessionService } from '../auth/auth-session.service';
import { CurrentUserStoreService } from '../auth/current-user-store.service';

interface RecoverRegistrationSeedResponse {
  ok: true;
  uid: string;
  created: boolean;
  recoveredAtMs: number;
}

export interface RegistrationRecoveryResult {
  user: IUserDados;
  created: boolean;
  recoveredAtMs: number;
}

@Injectable({ providedIn: 'root' })
export class RegistrationRecoveryService {
  private readonly functions = inject(Functions);
  private readonly session = inject(AuthSessionService);
  private readonly users = inject(FirestoreUserQueryService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly applicationError = inject(ApplicationErrorService);

  private readonly ACTION_TIMEOUT_MS = 15_000;

  private readonly recoverCallable = httpsCallable<
    Record<string, never>,
    RecoverRegistrationSeedResponse
  >(this.functions, 'recoverRegistrationSeed');

  recoverCurrentRegistration$(): Observable<RegistrationRecoveryResult> {
    return this.session.uid$.pipe(
      map((uid) => String(uid ?? '').trim()),
      take(1),
      switchMap((uid) => {
        if (!uid) {
          return throwError(() => new Error('Usuário não autenticado.'));
        }

        return this.recoverForUser$(uid);
      })
    );
  }

  recoverForUser$(uid: string): Observable<RegistrationRecoveryResult> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return throwError(() => new Error('UID inválido para recuperação.'));
    }

    return defer(() => from(this.recoverCallable({}))).pipe(
      timeout({ first: this.ACTION_TIMEOUT_MS }),
      map((response) => response.data),
      switchMap((result) => {
        if (
          result?.ok !== true ||
          result.uid !== safeUid ||
          !Number.isFinite(result.recoveredAtMs)
        ) {
          return throwError(
            () => new Error('A recuperação retornou dados inválidos.')
          );
        }

        return this.users.getUserOnceFromFirestore$(safeUid).pipe(
          take(1),
          map((user) => {
            if (!user?.uid || user.uid !== safeUid) {
              throw new Error(
                'O documento da conta não ficou disponível após a recuperação.'
              );
            }

            return {
              user,
              created: result.created === true,
              recoveredAtMs: result.recoveredAtMs,
            } satisfies RegistrationRecoveryResult;
          })
        );
      }),
      tap(({ user }) => {
        this.currentUserStore.set(user);
      }),
      catchError((error) => {
        this.reportError(error, safeUid);
        return throwError(() => error);
      })
    );
  }

  private reportError(error: unknown, uid: string): void {
    try {
      this.applicationError.report(error, {
        feature: 'registration-recovery',
        operation: 'recoverForUser',
        fallbackMessage:
          'Não foi possível recuperar os dados básicos da conta.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'RegistrationRecoveryService',
          uid,
        },
      });
    } catch {
      // Diagnóstico secundário não altera o fluxo de recuperação.
    }
  }
}
