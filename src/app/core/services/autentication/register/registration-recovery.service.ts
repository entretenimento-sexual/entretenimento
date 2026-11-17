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
import { FirestoreReadService } from '../../data-handling/firestore/core/firestore-read.service';
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
  private readonly users = inject(FirestoreReadService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly applicationError = inject(ApplicationErrorService);

  private readonly ACTION_TIMEOUT_MS = 15_000;

  private readonly recoverCallable = httpsCallable<
    { expectedUid: string },
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

  recoverForUser$(uid: string, { hydrate = true } = {}): Observable<RegistrationRecoveryResult> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return throwError(() => new Error('UID inválido para recuperação.'));
    }

    return defer(() => {
      const currentUser = this.session.currentAuthUser;
      const assertCurrentSession = () => {
        if (this.session.currentAuthUser !== currentUser || currentUser?.uid !== safeUid ||
            this.session.isTerminatingSnapshot) {
          throw new Error('A conta ativa mudou durante a recuperação.');
        }
      };

      assertCurrentSession();
      return from(this.recoverCallable({ expectedUid: safeUid })).pipe(
        map(({ data }) => {
          assertCurrentSession();
          return data;
        }),
        switchMap((result) => {
          if (result?.ok !== true || result.uid !== safeUid || !Number.isFinite(result.recoveredAtMs)) {
            throw new Error('A recuperação retornou dados inválidos.');
          }
          return this.users.getDocument<IUserDados>('users', safeUid, { source: 'server' }).pipe(
            take(1),
            map((user) => {
              assertCurrentSession();
              if (user?.uid !== safeUid) {
                throw new Error('O documento da conta não ficou disponível após a recuperação.');
              }
              return { user, created: result.created === true, recoveredAtMs: result.recoveredAtMs };
            }),
            tap(({ user }) => {
              if (hydrate) this.currentUserStore.set(user);
            })
          );
        })
      );
    }).pipe(
      timeout({ first: this.ACTION_TIMEOUT_MS }),
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
