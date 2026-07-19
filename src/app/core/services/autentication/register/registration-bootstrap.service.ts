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
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
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

  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
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
          this.safeHandle(
            '[RegistrationBootstrapService] createEmailPasswordSeed$ falhou.',
            error,
            {
              uid,
              traceId: input.traceId ?? null,
              nickname,
              normalized,
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
          this.safeHandle(
            '[RegistrationBootstrapService] createSocialSeed$ falhou.',
            error,
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

  private safeHandle(
    message: string,
    original: unknown,
    meta?: Record<string, unknown>
  ): void {
    try {
      const error = new Error(message) as Error & {
        original?: unknown;
        meta?: unknown;
        skipUserNotification?: boolean;
        silent?: boolean;
      };
      error.original = original;
      error.meta = meta;
      error.skipUserNotification = true;
      error.silent = true;
      this.globalErrorHandler.handleError(error);
    } catch {
      // Falha de diagnóstico não interrompe a operação principal.
    }
  }
}
