import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map, switchMap, take, timeout } from 'rxjs/operators';

import {
  IUserTermsAcceptance,
} from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  PLATFORM_LEGAL_MANIFEST,
  PRIVACY_NOTICE_VERSION,
  TERMS_ACCEPTANCE_VERSION,
  TERMS_DOCUMENT_VERSION,
} from './platform-legal.constants';

export {
  PLATFORM_LEGAL_MANIFEST,
  PRIVACY_NOTICE_VERSION,
  TERMS_ACCEPTANCE_VERSION,
  TERMS_DOCUMENT_VERSION,
} from './platform-legal.constants';

interface AcceptPlatformTermsPayload {
  acceptedTerms: true;
  acknowledgedPrivacyNotice: true;
}

interface AcceptPlatformTermsResponse {
  ok: true;
  version: string;
  termsDocumentVersion: string;
  privacyNoticeVersion: string;
  acceptanceContext: 'initial' | 'material_update';
  previousVersion: string | null;
  acceptedAtMs: number;
}

export interface AcceptedPlatformTermsResult {
  uid: string;
  record: IUserTermsAcceptance;
}

/**
 * Termos são fail-closed:
 * - ausência de registro exige aceite;
 * - accepted=false exige aceite;
 * - a versão registrada deve coincidir com a versão material atual;
 * - registros legados sem versão não satisfazem a versão v3.
 *
 * A ciência da Política de Privacidade é registrada no mesmo ato contratual,
 * sem ser convertida em consentimento genérico para tratamento de dados.
 *
 * SUPRESSÃO EXPLÍCITA:
 * `adultAccessAcknowledgement` deixou de ser coletado neste fluxo. A declaração
 * e a verificação de maioridade pertencem ao domínio separado de acesso adulto,
 * evitando pedir duas vezes a mesma confirmação ao usuário.
 */
export function hasAcceptedCurrentTerms(
  record: IUserTermsAcceptance | null | undefined
): boolean {
  if (record == null || record.accepted !== true) {
    return false;
  }

  const version = String(record.version ?? '').trim();

  if (!version || version !== TERMS_ACCEPTANCE_VERSION) {
    return false;
  }

  return record.acknowledgedPrivacyNotice === true;
}

@Injectable({ providedIn: 'root' })
export class TermsAcceptanceService {
  private readonly functions = inject(Functions);
  private readonly session = inject(AuthSessionService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly ACTION_TIMEOUT_MS = 15_000;

  private readonly acceptTermsCallable = httpsCallable<
    AcceptPlatformTermsPayload,
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

    const payload: AcceptPlatformTermsPayload = {
      acceptedTerms: true,
      acknowledgedPrivacyNotice: true,
    };

    return defer(() => from(this.acceptTermsCallable(payload))).pipe(
      timeout({ first: this.ACTION_TIMEOUT_MS }),
      map((response) => {
        const result = response.data;

        if (
          result?.ok !== true ||
          result.version !== TERMS_ACCEPTANCE_VERSION ||
          result.termsDocumentVersion !== TERMS_DOCUMENT_VERSION ||
          result.privacyNoticeVersion !== PRIVACY_NOTICE_VERSION ||
          !Number.isFinite(result.acceptedAtMs)
        ) {
          throw new Error(
            'A confirmação dos documentos legais retornou dados inválidos.'
          );
        }

        const record: IUserTermsAcceptance = {
          accepted: true,
          date: result.acceptedAtMs,
          version: result.version,
          termsDocumentVersion: result.termsDocumentVersion,
          privacyNoticeVersion: result.privacyNoticeVersion,
          acknowledgedPrivacyNotice: true,
          acceptanceContext: result.acceptanceContext,
          previousVersion: result.previousVersion,
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
      // Falha de diagnóstico não interfere na aceitação dos termos.
    }
  }
}
