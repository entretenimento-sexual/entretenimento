// src/app/core/services/autentication/register/registration-bootstrap.service.ts
// =============================================================================
// REGISTRATION BOOTSTRAP SERVICE
// =============================================================================
// Fonte canônica para o nascimento do documento privado da conta.
//
// Privacidade por padrão:
// - o cadastro inicial NÃO cria public_profiles/{uid};
// - a projeção pública nasce atomicamente apenas em ProfileCompletionWriteService;
// - o perfil não fica consultável antes de e-mail/termos/consentimento/onboarding;
// - a reserva de nickname permanece no public_index durante esta migração.
// =============================================================================
import { Injectable } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { IUserRegistrationData } from 'src/app/core/interfaces/iuser-registration-data';
import { ApplicationErrorService } from '../../error-handler/application-error.service';
import { FirestoreContextService } from '../../data-handling/firestore/core/firestore-context.service';
import { NicknameUtils } from '@core/utils/nickname-utils';

const REGISTRATION_FLOW_VERSION = 'v3-private-by-default';

export interface EmailPasswordRegistrationBootstrapInput {
  uid: string;
  userData: IUserRegistrationData;
  traceId?: string;
}

export interface SocialRegistrationBootstrapInput {
  uid: string;
  email: string;
  emailVerified: boolean;
  photoURL?: string | null;
  providerIds?: string[];
  providerId?: string;
  nowMs?: number;
}

@Injectable({ providedIn: 'root' })
export class RegistrationBootstrapService {
  private readonly NICKNAME_NORM_RE = /^[a-z0-9._-]{3,40}$/;
  private readonly diagnosedErrors = new WeakSet<object>();

  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly applicationError: ApplicationErrorService
  ) {}

  createEmailPasswordSeed$(
    input: EmailPasswordRegistrationBootstrapInput
  ): Observable<void> {
    const uid = this.cleanText(input.uid);
    const nickname = this.cleanText(input.userData?.nickname);
    const email = this.cleanText(input.userData?.email).toLowerCase();
    const normalized = this.normalizeNickname(nickname);
    const nowMs = Date.now();

    if (!uid) {
      return throwError(
        () => new Error('[RegistrationBootstrapService] UID inválido.')
      );
    }

    if (!nickname || !this.NICKNAME_NORM_RE.test(normalized)) {
      return throwError(
        () => new Error('[RegistrationBootstrapService] Apelido inválido.')
      );
    }

    const userRef = doc(this.db as any, 'users', uid);
    const indexRef = doc(
      this.db as any,
      'public_index',
      `nickname:${normalized}`
    );

    return this.ctx
      .deferPromise$(() =>
        runTransaction(this.db as any, async (tx) => {
          const indexSnapshot = await tx.get(indexRef);

          if (indexSnapshot.exists()) {
            const error = new Error('Apelido já está em uso.') as Error & {
              code?: string;
            };
            error.code = 'nickname/in-use';
            throw error;
          }

          tx.set(
            userRef,
            {
              uid,
              email,
              nickname,

              role: 'free',
              tier: 'free',

              emailVerified: false,
              isSubscriber: false,
              subscriptionStatus: 'inactive',
              accountStatus: 'active',
              profileCompleted: false,
              publicVisibility: 'hidden',
              interactionBlocked: true,
              loginAllowed: true,
              registrationFlowVersion: REGISTRATION_FLOW_VERSION,
              initialAdultConsentRequired: true,
              registrationCompletedAt: null,

              acceptedTerms: {
                accepted: false,
                date: serverTimestamp(),
              },

              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              registrationDate: serverTimestamp(),
              firstLogin: serverTimestamp(),

              nicknameHistory: [
                {
                  nickname: normalized,
                  date: Timestamp.fromMillis(nowMs),
                },
              ],
            },
            { merge: true }
          );

          tx.set(indexRef, {
            uid,
            type: 'nickname',
            value: normalized,
            createdAt: serverTimestamp(),
            lastChangedAt: serverTimestamp(),
          });
        })
      )
      .pipe(
        map(() => void 0),
        catchError((error) => {
          this.reportOperationalError(
            error,
            'createEmailPasswordSeed',
            {
              uid,
              traceId: input.traceId ?? null,
              nicknamePresent: !!nickname,
              normalizedLength: normalized.length,
            }
          );
          return throwError(() => error);
        })
      );
  }

  createSocialSeed$(
    input: SocialRegistrationBootstrapInput
  ): Observable<void> {
    const uid = this.cleanText(input.uid);
    const email = this.cleanText(input.email).toLowerCase();
    const photoURL = this.cleanText(input.photoURL);
    const providerIds = this.cleanStringList(input.providerIds);
    const providerId = this.cleanText(input.providerId) || 'google.com';
    const nowMs = Number.isFinite(input.nowMs)
      ? Number(input.nowMs)
      : Date.now();

    if (!uid) {
      return throwError(
        () => new Error('[RegistrationBootstrapService] UID inválido.')
      );
    }

    const userRef = doc(this.db as any, 'users', uid);

    return this.ctx
      .deferPromise$(async () => {
        const batch = writeBatch(this.db as any);

        batch.set(
          userRef,
          {
            uid,
            email,
            nickname: '',
            ...(photoURL ? { photoURL } : {}),

            role: 'free',
            tier: 'free',

            emailVerified: input.emailVerified === true,
            isSubscriber: false,
            subscriptionStatus: 'inactive',
            accountStatus: 'active',
            profileCompleted: false,
            publicVisibility: 'hidden',
            interactionBlocked: true,
            loginAllowed: true,
            registrationFlowVersion: REGISTRATION_FLOW_VERSION,
            initialAdultConsentRequired: true,
            registrationCompletedAt: null,

            acceptedTerms: {
              accepted: false,
              date: Timestamp.fromMillis(nowMs),
            },

            roles: ['user'],
            permissions: [],
            entitlements: [],
            suspended: false,
            accountLocked: false,

            authProviders: Array.from(
              new Set([...providerIds, providerId])
            ),
            lastProvider: providerId,

            firstLogin: Timestamp.fromMillis(nowMs),
            registrationDate: Timestamp.fromMillis(nowMs),
            lastLogin: Timestamp.fromMillis(nowMs),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedAtMs: nowMs,
          },
          { merge: true }
        );

        await batch.commit();
      })
      .pipe(
        map(() => void 0),
        catchError((error) => {
          this.reportOperationalError(
            error,
            'createSocialSeed',
            {
              uid,
              emailPresent: !!email,
              providerId,
            }
          );
          return throwError(() => error);
        })
      );
  }

  private normalizeNickname(nickname: string): string {
    return NicknameUtils.normalizarApelidoParaIndice(nickname);
  }

  private cleanText(value: unknown): string {
    return String(value ?? '').trim();
  }

  private cleanStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
      .map((item) => this.cleanText(item))
      .filter(Boolean);
  }

  /**
   * Informa aos consumidores se esta instância já assumiu o diagnóstico técnico
   * do mesmo objeto de erro. O WeakSet evita mutar erros de Firebase/Firestore.
   */
  hasDiagnosticOwnership(error: unknown): boolean {
    return this.isTrackableError(error)
      && this.diagnosedErrors.has(error as object);
  }

  private reportOperationalError(
    error: unknown,
    operation: 'createEmailPasswordSeed' | 'createSocialSeed',
    metadata: Record<string, unknown>
  ): void {
    if (this.hasDiagnosticOwnership(error)) {
      return;
    }

    try {
      this.applicationError.report(error, {
        feature: 'registration-bootstrap',
        operation,
        fallbackMessage:
          'Não foi possível concluir a preparação inicial da conta.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'RegistrationBootstrapService',
          ...metadata,
        },
      });

      this.markDiagnosticOwnership(error);
    } catch {
      // O consumidor poderá assumir o fallback sem alterar o erro público.
    }
  }

  private markDiagnosticOwnership(error: unknown): void {
    if (this.isTrackableError(error)) {
      this.diagnosedErrors.add(error as object);
    }
  }

  private isTrackableError(error: unknown): boolean {
    return (
      (typeof error === 'object' && error !== null) ||
      typeof error === 'function'
    );
  }
}
