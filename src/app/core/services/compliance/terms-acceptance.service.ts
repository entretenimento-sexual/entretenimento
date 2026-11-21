import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, throwError } from 'rxjs';
import { catchError, map, switchMap, timeout } from 'rxjs/operators';

import {
  IUserTermsAcceptance,
} from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { LocalDraftService } from 'src/app/core/services/drafts/local-draft.service';
import {
  ADULT_SELF_DECLARATION_VERSION,
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
  expectedUid: string;
  acceptedTerms: true;
  acknowledgedPrivacyNotice: true;
  version: string;
  termsDocumentVersion: string;
  privacyNoticeVersion: string;
  signupAdultDeclarationVersion?: string;
}

interface AcceptPlatformTermsResponse {
  ok: true;
  version: string;
  termsDocumentVersion: string;
  privacyNoticeVersion: string;
  acceptanceContext: 'initial' | 'material_update';
  previousVersion: string | null;
  acceptedAtMs: number;
  signupAdultDeclarationRecorded?: true;
}

export interface AcceptedPlatformTermsResult {
  uid: string;
  record: IUserTermsAcceptance;
  signupAdultDeclarationRecorded?: true;
}

export function isCurrentTermsRecordAccepted(
  record: IUserTermsAcceptance | null | undefined
): boolean {
  return record?.accepted === true &&
    record.acknowledgedPrivacyNotice === true &&
    record.version === TERMS_ACCEPTANCE_VERSION &&
    record.termsDocumentVersion === TERMS_DOCUMENT_VERSION &&
    record.privacyNoticeVersion === PRIVACY_NOTICE_VERSION;
}

export const hasAcceptedCurrentTerms = isCurrentTermsRecordAccepted;
export const isCurrentLegalAcceptanceSatisfied = isCurrentTermsRecordAccepted;

export function isTermsVersionMismatch(error: unknown): boolean {
  return (error as { details?: { reason?: unknown } } | null)?.details?.reason ===
    'terms/version-mismatch';
}

@Injectable({ providedIn: 'root' })
export class TermsAcceptanceService {
  private readonly localDraft = inject(LocalDraftService);
  private readonly functions = inject(Functions);
  private readonly session = inject(AuthSessionService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  private readonly ACTION_TIMEOUT_MS = 15_000;

  private readonly acceptTermsCallable = httpsCallable<
    AcceptPlatformTermsPayload,
    AcceptPlatformTermsResponse
  >(this.functions, 'acceptPlatformTerms');

  rememberPendingSignupAcceptance(uid: string): void {
    this.assertActiveSession(uid);
    this.localDraft.save(`registration-acceptance:${uid}`, {
      uid,
      version: TERMS_ACCEPTANCE_VERSION,
      terms: TERMS_DOCUMENT_VERSION,
      privacy: PRIVACY_NOTICE_VERSION,
      declaration: ADULT_SELF_DECLARATION_VERSION,
    });
  }

  hasPendingSignupAcceptance(uid: string): boolean {
    const user = this.session.currentAuthUser;
    if (this.session.isTerminatingSnapshot ||
        user?.uid !== uid || !user.emailVerified) return false;
    const draft = this.localDraft.load(`registration-acceptance:${uid}`);
    return draft?.['uid'] === uid && draft['version'] === TERMS_ACCEPTANCE_VERSION &&
      draft['terms'] === TERMS_DOCUMENT_VERSION &&
      draft['privacy'] === PRIVACY_NOTICE_VERSION &&
      draft['declaration'] === ADULT_SELF_DECLARATION_VERSION;
  }

  clearPendingSignupAcceptance(uid: string): void {
    this.localDraft.remove(`registration-acceptance:${uid}`);
  }

  acceptCurrentTerms$(expectedUid = this.session.currentAuthUser?.uid): Observable<AcceptedPlatformTermsResult> {
    /**
     * Aceite persistente é uma operação autenticada e não pode confiar apenas
     * no snapshot local de UID. Aguardamos o restore canônico do Firebase Auth
     * e exigimos um ID token válido do usuário atual antes de chamar a Function.
     */
    return defer(() => from(this.session.whenReady())).pipe(
      switchMap(() => {
        const user = this.session.currentAuthUser;
        const uid = String(user?.uid ?? '').trim();

        if (!user || !uid) {
          return throwError(() => new Error('Usuário não autenticado.'));
        }
        if (expectedUid) this.assertActiveSession(expectedUid);

        return defer(() => from(user.getIdToken())).pipe(
          map(() => uid),
          catchError((error) => {
            this.reportError(error, 'validateAuthSession', { uid });
            return throwError(() => error);
          })
        );
      }),
      switchMap((uid) => this.acceptForUser$(uid)),
      timeout({ first: this.ACTION_TIMEOUT_MS })
    );
  }

  acceptForUser$(
    uid: string,
    { signupAdultDeclaration = false } = {}
  ): Observable<AcceptedPlatformTermsResult> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return throwError(() => new Error('UID inválido.'));
    }

    const payload: AcceptPlatformTermsPayload = {
      expectedUid: safeUid,
      acceptedTerms: true,
      acknowledgedPrivacyNotice: true,
      version: TERMS_ACCEPTANCE_VERSION,
      termsDocumentVersion: TERMS_DOCUMENT_VERSION,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      ...(signupAdultDeclaration
        ? { signupAdultDeclarationVersion: ADULT_SELF_DECLARATION_VERSION }
        : {}),
    };

    return defer(() => {
      this.assertActiveSession(safeUid);
      return from(this.acceptTermsCallable(payload));
    }).pipe(
      timeout({ first: this.ACTION_TIMEOUT_MS }),
      map((response) => {
        this.assertActiveSession(safeUid);
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

        if (this.currentUserStore.getSnapshot()?.uid === safeUid) {
          this.currentUserStore.patch({ acceptedTerms: record });
        }
        if (signupAdultDeclaration && result.signupAdultDeclarationRecorded === true) {
          this.clearPendingSignupAcceptance(safeUid);
        }

        return {
          uid: safeUid,
          record,
          ...(result.signupAdultDeclarationRecorded === true
            ? { signupAdultDeclarationRecorded: true as const }
            : {}),
        };
      }),
      catchError((error) => {
        if (isTermsVersionMismatch(error)) {
          this.clearPendingSignupAcceptance(safeUid);
        } else {
          this.reportError(error, 'acceptForUser', { uid: safeUid });
        }
        return throwError(() => error);
      })
    );
  }

  private assertActiveSession(uid: string): void {
    if (this.session.isTerminatingSnapshot || this.session.currentAuthUser?.uid !== uid) {
      throw Object.assign(new Error('A conta ativa mudou durante o aceite dos termos.'), {
        code: 'auth/session-changed',
      });
    }
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
