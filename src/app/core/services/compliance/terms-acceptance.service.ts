import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map, switchMap, take } from 'rxjs/operators';

import {
  IUserTermsAcceptance,
} from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

export const TERMS_ACCEPTANCE_VERSION = 'v1';

interface AcceptPlatformTermsResponse {
  ok: true;
  version: string;
  acceptedAtMs: number;
}

export interface AcceptedPlatformTermsResult {
  uid: string;
  record: IUserTermsAcceptance;
}

/**
 * Compatibilidade controlada:
 * - ausência total do campo representa conta legada e não bloqueia esta migração;
 * - accepted=false sempre exige a etapa;
 * - registros versionados devem coincidir com a versão atual;
 * - accepted=true sem versão é tratado como v1 somente nesta migração inicial.
 */
export function hasAcceptedCurrentTerms(
  record: IUserTermsAcceptance | null | undefined
): boolean {
  if (record == null) {
    return true;
  }

  if (record.accepted !== true) {
    return false;
  }

  const version = String(record.version ?? '').trim();

  if (version) {
    return version === TERMS_ACCEPTANCE_VERSION;
  }

  return TERMS_ACCEPTANCE_VERSION === 'v1';
}

@Injectable({ providedIn: 'root' })
export class TermsAcceptanceService {
  private readonly functions = inject(Functions);
  private readonly session = inject(AuthSessionService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly acceptTermsCallable = httpsCallable<
    Record<string, never>,
    AcceptPlatformTermsResponse
  >(this.functions, 'acceptPlatformTerms');

  acceptCurrentTerms$(): Observable<AcceptedPlatformTermsResult> {
    return this.session.uid$.pipe(
      map((uid) => String(uid ?? '').trim()),
      take(1),
      switchMap((uid) => {
        if (!uid) {
          return throwError(() => new Error('Usuário não autenticado.'));
        }

        return this.acceptForUser$(uid);
      })
    );
  }

  acceptForUser$(uid: string): Observable<AcceptedPlatformTermsResult> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return throwError(() => new Error('UID inválido.'));
    }

    return defer(() => from(this.acceptTermsCallable({}))).pipe(
      map((response) => {
        const result = response.data;

        if (
          result?.ok !== true ||
          result.version !== TERMS_ACCEPTANCE_VERSION ||
          !Number.isFinite(result.acceptedAtMs)
        ) {
          throw new Error('A confirmação dos termos retornou dados inválidos.');
        }

        const record: IUserTermsAcceptance = {
          accepted: true,
          date: result.acceptedAtMs,
          version: result.version,
          acceptedAt: result.acceptedAtMs,
          updatedAt: result.acceptedAtMs,
          source: 'web',
        };

        this.currentUserStore.patch({ acceptedTerms: record });

        return {
          uid: safeUid,
          record,
        };
      }),
      catchError((error) => {
        this.reportError(error, 'acceptForUser', { uid: safeUid });
        return throwError(() => error);
      })
    );
  }

  private reportError(
    error: unknown,
    operation: string,
    extra: Record<string, unknown>
  ): void {
    try {
      const err = error instanceof Error
        ? error
        : new Error('[TermsAcceptanceService] operation failed');

      (err as any).context = 'TermsAcceptanceService';
      (err as any).operation = operation;
      (err as any).extra = extra;
      (err as any).original = error;
      (err as any).skipUserNotification = true;

      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
}
