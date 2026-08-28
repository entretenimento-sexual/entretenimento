import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap, take, timeout } from 'rxjs/operators';

import {
  IUserTermsAcceptance,
} from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { environment } from 'src/environments/environment';
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

/**
 * Política de execução do aceite jurídico.
 *
 * Produção é sempre fail-closed. O único bypass permitido é o ambiente local
 * explicitamente configurado com `enforceCurrentLegalAcceptance: false`.
 * Isso impede que uma Function remota fora de sincronia interrompa todo o
 * desenvolvimento local, sem alterar qualquer registro jurídico no Firestore.
 */
export const CURRENT_LEGAL_ACCEPTANCE_ENFORCED =
  environment.production ||
  environment.features?.enforceCurrentLegalAcceptance !== false;

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
 * Validação estrita do registro jurídico persistido.
 *
 * Não considera bypass de ambiente. Deve ser usada para status jurídico,
 * auditoria e qualquer UI que precise refletir exatamente o que está gravado.
 */
export function isCurrentTermsRecordAccepted(
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

/**
 * API histórica de gating da aplicação.
 *
 * SUPRESSÃO EXPLÍCITA EM DESENVOLVIMENTO:
 * quando `CURRENT_LEGAL_ACCEPTANCE_ENFORCED === false`, somente a barreira de
 * navegação e as chamadas automáticas de reaceite são suprimidas. Nenhum dado
 * jurídico persistido é criado ou alterado por essa decisão de ambiente.
 */
export function hasAcceptedCurrentTerms(
  record: IUserTermsAcceptance | null | undefined
): boolean {
  return !CURRENT_LEGAL_ACCEPTANCE_ENFORCED || isCurrentTermsRecordAccepted(record);
}

/**
 * Alias semântico para consumidores que deixam explícito tratar-se de política
 * de acesso, e não de validação do registro persistido.
 */
export function isCurrentLegalAcceptanceSatisfied(
  record: IUserTermsAcceptance | null | undefined
): boolean {
  return hasAcceptedCurrentTerms(record);
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

    /**
     * Em desenvolvimento local o aceite jurídico está deliberadamente fora do
     * caminho crítico. Não chamamos Cloud Functions e, principalmente, não
     * simulamos persistência no Firestore. O registro abaixo existe apenas para
     * satisfazer o contrato de retorno do fluxo local.
     */
    if (!CURRENT_LEGAL_ACCEPTANCE_ENFORCED) {
      const now = Date.now();
      const record: IUserTermsAcceptance = {
        accepted: true,
        date: now,
        version: TERMS_ACCEPTANCE_VERSION,
        termsDocumentVersion: TERMS_DOCUMENT_VERSION,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        acknowledgedPrivacyNotice: true,
        acceptanceContext: 'initial',
        previousVersion: null,
        acceptedAt: now,
        updatedAt: now,
        source: 'web',
      };

      return of({
        uid: safeUid,
        record,
      });
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
