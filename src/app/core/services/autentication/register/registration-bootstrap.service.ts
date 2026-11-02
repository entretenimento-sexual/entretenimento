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
import { EnvironmentInjector, Injectable, Optional, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore } from '@angular/fire/firestore';
import {
  doc,
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
    private readonly applicationError: ApplicationErrorService,
    @Optional() private readonly functions?: Functions,
    @Optional() private readonly injector?: EnvironmentInjector
  ) {}

  createEmailPasswordSeed$(
    input: EmailPasswordRegistrationBootstrapInput
  ): Observable<void> {
    const uid = this.cleanText(input.uid);
    const nickname = this.cleanText(input.userData?.nickname);
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

    // A reserva é transacional no backend: o cliente envia apenas o display.
    // Não gravar public_index ou nicknameHistory a partir do SDK do navegador.
    return this.ctx
      .deferPromise$(() => {
        if (!this.functions || !this.injector) {
          throw new Error('Serviço de reserva de nickname indisponível.');
        }
        const callable = runInInjectionContext(this.injector, () =>
          httpsCallable<{ nickname: string }, { nickname: string; normalized: string }>(
            this.functions!, 'reserveRegistrationNickname'
          )
        );
        return callable({ nickname });
      })
      .pipe(
        map(() => void 0),
        catchError((error) => {
          this.reportOperationalError(error, 'createEmailPasswordSeed', {
            uid, traceId: input.traceId ?? null,
            nicknamePresent: !!nickname, normalizedLength: normalized.length,
          });
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
