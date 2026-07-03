// src/app/core/services/autentication/register/registration-bootstrap.service.ts
// =============================================================================
// RegistrationBootstrapService
//
// Fonte canônica para criação inicial dos documentos de conta.
//
// Objetivo arquitetural:
// - concentrar a política de nascimento do usuário;
// - evitar que register-module, RegisterService, SocialAuthService ou effects
//   criem seeds divergentes;
// - manter usuários criados por e-mail/senha e por login social compatíveis;
// - preservar writes reativos com Observable;
// - manter compatibilidade com rules atuais.
//
// Uso previsto:
// - RegisterService: criação por e-mail/senha;
// - SocialAuthService: primeira entrada via Google/social;
// - futuras Cloud Functions ou fluxos mobile podem espelhar este contrato.
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
    const email = this.cleanText(input.userData?.email);
    const normalized = this.normalizeNickname(nickname);
    const nowMs = Date.now();

    if (!uid) {
      return throwError(() => new Error('[RegistrationBootstrapService] UID inválido.'));
    }

    if (!nickname || !this.NICKNAME_NORM_RE.test(normalized)) {
      return throwError(() => new Error('[RegistrationBootstrapService] Apelido inválido.'));
    }

    const userRef = doc(this.db as any, 'users', uid);
    const indexRef = doc(this.db as any, 'public_index', `nickname:${normalized}`);
    const publicProfileRef = doc(this.db as any, 'public_profiles', uid);

    return this.ctx.deferPromise$(() =>
      runTransaction(this.db as any, async (tx) => {
        const idxSnap = await tx.get(indexRef);

        if (idxSnap.exists()) {
          const err: any = new Error('Apelido já está em uso.');
          err.code = 'nickname/in-use';
          throw err;
        }

        tx.set(userRef, {
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

          acceptedTerms: {
            accepted: true,
            date: serverTimestamp(),
          },

          createdAt: serverTimestamp(),
          registrationDate: serverTimestamp(),
          firstLogin: serverTimestamp(),

          nicknameHistory: [
            { nickname: normalized, date: Timestamp.fromMillis(nowMs) },
          ],
        }, { merge: true });

        tx.set(indexRef, {
          uid,
          type: 'nickname',
          value: normalized,
          createdAt: serverTimestamp(),
          lastChangedAt: serverTimestamp(),
        });

        tx.set(publicProfileRef, {
          uid,
          nickname,
          nicknameNormalized: normalized,
          role: 'free',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      })
    ).pipe(
      map(() => void 0),
      catchError((err) => {
        this.safeHandle(
          '[RegistrationBootstrapService] createEmailPasswordSeed$ falhou.',
          err,
          {
            uid,
            traceId: input.traceId ?? null,
            nickname,
            normalized,
          }
        );

        return throwError(() => err);
      })
    );
  }

  createSocialSeed$(input: SocialRegistrationBootstrapInput): Observable<void> {
    const uid = this.cleanText(input.uid);
    const email = this.cleanText(input.email);
    const photoURL = this.cleanText(input.photoURL);
    const providerIds = this.cleanStringList(input.providerIds);
    const providerId = this.cleanText(input.providerId) || 'google.com';
    const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();

    if (!uid) {
      return throwError(() => new Error('[RegistrationBootstrapService] UID inválido.'));
    }

    const userRef = doc(this.db as any, 'users', uid);
    const publicProfileRef = doc(this.db as any, 'public_profiles', uid);

    return this.ctx.deferPromise$(async () => {
      const batch = writeBatch(this.db as any);

      batch.set(userRef, {
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

        acceptedTerms: {
          accepted: false,
          date: Timestamp.fromMillis(nowMs),
        },

        roles: ['user'],
        permissions: [],
        entitlements: [],

        suspended: false,
        accountLocked: false,
        publicVisibility: 'visible',
        interactionBlocked: false,
        loginAllowed: true,

        authProviders: Array.from(new Set([...providerIds, providerId])),
        lastProvider: providerId,

        firstLogin: Timestamp.fromMillis(nowMs),
        registrationDate: Timestamp.fromMillis(nowMs),
        lastLogin: Timestamp.fromMillis(nowMs),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });

      batch.set(publicProfileRef, {
        uid,
        ...(photoURL ? { photoURL } : {}),
        role: 'free',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      await batch.commit();
    }).pipe(
      map(() => void 0),
      catchError((err) => {
        this.safeHandle(
          '[RegistrationBootstrapService] createSocialSeed$ falhou.',
          err,
          {
            uid,
            emailPresent: !!email,
            providerId,
          }
        );

        return throwError(() => err);
      })
    );
  }

  private normalizeNickname(nickname: string): string {
    return NicknameUtils.normalizarApelidoParaIndice(nickname);
  }

  private cleanText(value: unknown): string {
    return (value ?? '').toString().trim();
  }

  private cleanStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
      .map((item) => this.cleanText(item))
      .filter(Boolean);
  }

  private safeHandle(
    msg: string,
    original: unknown,
    meta?: Record<string, unknown>
  ): void {
    try {
      const e = new Error(msg);
      (e as any).original = original;
      (e as any).meta = meta;
      (e as any).skipUserNotification = true;
      (e as any).silent = true;
      this.globalErrorHandler.handleError(e);
    } catch {
      // noop
    }
  }
}
