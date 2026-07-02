// src/app/core/services/data-handling/firestore-user-write.service.ts
// -----------------------------------------------------------------------------
// FirestoreUserWriteService
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - centralizar escritas relacionadas ao documento privado do usuário;
// - centralizar o recorte público em public_profiles;
// - manter separação entre:
//   1. finalização de perfil;
//   2. verificação de e-mail.
//
// Regras importantes:
//
// - saveInitialUserData$:
//   usado para completar o perfil.
//   Grava profileCompleted e dados mínimos do perfil.
//   NÃO grava emailVerified.
//
// - patchEmailVerified$ / patchEmailVerifiedByEmail$:
//   usados para verificação de e-mail.
//   Gravam somente emailVerified.
//   NÃO gravam profileCompleted.
//
// - public_profiles:
//   recebe somente dados públicos permitidos pelas rules.
//   NÃO recebe emailVerified nem profileCompleted.

import { Injectable } from '@angular/core';

import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from '@angular/fire/firestore';

import { serverTimestamp, writeBatch } from 'firebase/firestore';
import type { User } from 'firebase/auth';

import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import type { IUserDados } from '@core/interfaces/iuser-dados';
import type { IUserRegistrationData } from '@core/interfaces/iuser-registration-data';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { FirestoreContextService } from './firestore/core/firestore-context.service';
import { NicknameUtils } from '@core/utils/nickname-utils';

type ProfileCompletionPayload = Partial<IUserRegistrationData> & Partial<IUserDados>;

@Injectable({ providedIn: 'root' })
export class FirestoreUserWriteService {
  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  /**
   * Best-effort: garante /users/{uid} sem sobrescrever createdAt.
   *
   * Não deve ser usado para marcar profileCompleted.
   */
  ensureUserDoc$(authUser: User, base: Partial<IUserDados>): Observable<void> {
    const ref = this.ctx.run(() => doc(this.db, 'users', authUser.uid));

    return this.ctx.deferPromise$(() => getDoc(ref)).pipe(
      switchMap((snap) => {
        const payloadBase: Record<string, unknown> = {
          uid: authUser.uid,
          email: authUser.email ?? null,
          nickname: base.nickname ?? null,
          emailVerified: !!authUser.emailVerified,
        };

        const payload = snap.exists()
          ? payloadBase
          : {
              ...payloadBase,
              createdAt: serverTimestamp(),
              firstLogin: serverTimestamp(),
              lastLogin: serverTimestamp(),
              registrationDate: serverTimestamp(),
            };

        return this.ctx
          .deferPromise$(() => setDoc(ref, payload as any, { merge: true }))
          .pipe(map(() => void 0));
      }),
      catchError((err) => {
        this.safeHandle(
          '[FirestoreUserWriteService] ensureUserDoc falhou (ignorado).',
          err,
          { uid: authUser.uid },
          { silent: true }
        );

        return of(void 0);
      })
    );
  }

  patchLastLogin$(uid: string): Observable<void> {
    const safeUid = (uid ?? '').trim();

    if (!safeUid) {
      return of(void 0);
    }

    const ref = this.ctx.run(() => doc(this.db, 'users', safeUid));

    return this.ctx
      .deferPromise$(() =>
        setDoc(ref, { lastLogin: serverTimestamp() } as any, { merge: true })
      )
      .pipe(
        map(() => void 0),
        catchError((err) => {
          this.safeHandle(
            '[FirestoreUserWriteService] patchLastLogin falhou (ignorado).',
            err,
            { uid: safeUid },
            { silent: true }
          );

          return of(void 0);
        })
      );
  }

  /**
   * Ato exclusivo de verificação de e-mail.
   *
   * Não grava profileCompleted.
   */
  patchEmailVerified$(uid: string, status: boolean): Observable<void> {
    const safeUid = (uid ?? '').trim();

    if (!safeUid) {
      return throwError(() => new Error('[FirestoreUserWriteService] UID inválido.'));
    }

    const ref = this.ctx.run(() => doc(this.db, 'users', safeUid));

    return this.ctx
      .deferPromise$(() =>
        updateDoc(ref, {
          emailVerified: status === true,
        } as any)
      )
      .pipe(
        map(() => void 0)
      );
  }

  /**
   * Ato exclusivo de verificação de e-mail por e-mail.
   *
   * Usado quando o usuário abriu o link sem sessão ativa.
   * Não grava profileCompleted.
   */
  patchEmailVerifiedByEmail$(
    email: string,
    status: boolean = true
  ): Observable<void> {
    const safeEmail = (email ?? '').trim();

    if (!safeEmail) {
      return throwError(() => new Error('[FirestoreUserWriteService] E-mail inválido.'));
    }

    const qref = this.ctx.run(() =>
      query(collection(this.db, 'users'), where('email', '==', safeEmail))
    );

    return this.ctx.deferPromise$(() => getDocs(qref)).pipe(
      switchMap((snap) => {
        if (snap.empty) {
          throw new Error('Usuário não encontrado pelo e-mail.');
        }

        return from(
          Promise.all(
            snap.docs.map((d) =>
              updateDoc(d.ref, {
                emailVerified: status === true,
              } as any)
            )
          )
        );
      }),
      map(() => void 0),
      catchError((err) => {
        this.safeHandle(
          '[FirestoreUserWriteService] patchEmailVerifiedByEmail falhou.',
          err,
          { email: safeEmail },
          { silent: false }
        );

        return throwError(() => err);
      })
    );
  }

  /**
   * Finalização de perfil.
   *
   * Responsabilidades:
   * - users/{uid}: grava somente dados de conclusão do perfil;
   * - public_profiles/{uid}: grava somente o recorte público permitido.
   *
   * Não grava:
   * - emailVerified;
   * - e-mail;
   * - acceptedTerms;
   * - firstLogin;
   * - registrationDate;
   * - dados privados/administrativos.
   */
  saveInitialUserData$(
    uid: string,
    data: ProfileCompletionPayload
  ): Observable<void> {
    const safeUid = (uid ?? '').trim();

    if (!safeUid) {
      return throwError(() => new Error('[FirestoreUserWriteService] UID inválido.'));
    }

    const userRef = this.ctx.run(() => doc(this.db, 'users', safeUid));
    const publicProfileRef = this.ctx.run(() =>
      doc(this.db, 'public_profiles', safeUid)
    );

    return this.ctx.deferPromise$(async () => {
      const publicProfileSnap = await getDoc(publicProfileRef);
      const existingPublicProfile = publicProfileSnap.exists()
        ? (publicProfileSnap.data() as Record<string, unknown>)
        : null;

      const batch = writeBatch(this.db as any);

      batch.set(
        userRef as any,
        this.buildUserProfileCompletionPatch(safeUid, data) as any,
        { merge: true }
      );

      /**
       * Usa overwrite sanitizado em public_profiles.
       *
       * Motivo: perfis legados podem conter campos fora da whitelist atual das
       * rules. Um merge preservaria esses campos no documento final e faria o
       * update ser negado por permissão. O overwrite mantém somente campos
       * públicos permitidos, preservando campos imutáveis/server-owned quando
       * já existirem.
       */
      batch.set(
        publicProfileRef as any,
        this.buildPublicProfileCompletionPatch(
          safeUid,
          data,
          existingPublicProfile
        ) as any
      );

      await batch.commit();
    }).pipe(
      map(() => void 0),
      catchError((err) => {
        this.safeHandle(
          '[FirestoreUserWriteService] saveInitialUserData$ falhou.',
          err,
          { uid: safeUid },
          { silent: true }
        );

        return throwError(() => err);
      })
    );
  }

  /**
   * Compatibilidade.
   *
   * Mantido para chamadas antigas, mas agora respeita a separação:
   * verificação de e-mail só grava emailVerified.
   *
   * Não grava profileCompleted, mesmo que o objeto user venha com esse campo.
   */
  saveUserDataAfterEmailVerification$(user: IUserDados): Observable<void> {
    if (!user?.uid) {
      return throwError(() => new Error('UID do usuário não definido.'));
    }

    return this.patchEmailVerified$(user.uid, true).pipe(
      catchError((err) => {
        this.safeHandle(
          '[FirestoreUserWriteService] saveUserDataAfterEmailVerification falhou.',
          err,
          { uid: user.uid },
          { silent: false }
        );

        return throwError(() => err);
      })
    );
  }

  /**
   * Patch privado da conclusão do perfil.
   *
   * Não inclui emailVerified.
   */
  private buildUserProfileCompletionPatch(
    uid: string,
    data: ProfileCompletionPayload
  ): Record<string, unknown> {
    const patch: Record<string, unknown> = {
      uid,
      profileCompleted: true,
    };

    const nickname = this.cleanText(data.nickname);
    if (nickname) {
      patch['nickname'] = nickname;
    }

    const gender = this.cleanText(data.gender);
    if (gender) {
      patch['gender'] = gender;
    }

    const orientation = this.cleanText(data.orientation);
    if (orientation) {
      patch['orientation'] = orientation;
    }

    const estado = this.cleanText(data.estado);
    if (estado) {
      patch['estado'] = estado;
    }

    const municipio = this.cleanText(data.municipio);
    if (municipio) {
      patch['municipio'] = municipio;
    }

    const photoURL = this.cleanText(data.photoURL);
    if (this.isHttpUrl(photoURL)) {
      patch['photoURL'] = photoURL;
    }

    return patch;
  }

  /**
   * Documento público sanitizado da conclusão do perfil.
   *
   * Não inclui:
   * - email;
   * - emailVerified;
   * - profileCompleted;
   * - acceptedTerms;
   * - firstLogin;
   * - lastLogin;
   * - registrationDate;
   * - nicknameHistory.
   */
  private buildPublicProfileCompletionPatch(
    uid: string,
    data: ProfileCompletionPayload,
    existing: Record<string, unknown> | null
  ): Record<string, unknown> {
    const nickname = this.cleanText(data.nickname);

    const patch: Record<string, unknown> = {
      uid,
      updatedAt: serverTimestamp(),

      gender: this.cleanTextOrNull(data.gender),
      orientation: this.cleanTextOrNull(data.orientation),
      estado: this.cleanTextOrNull(data.estado),
      municipio: this.cleanTextOrNull(data.municipio),
    };

    if (nickname) {
      patch['nickname'] = nickname;
      patch['nicknameNormalized'] =
        NicknameUtils.normalizarApelidoParaIndice(nickname);
    }

    const photoURL = this.cleanText(data.photoURL);
    if (this.isHttpUrl(photoURL)) {
      patch['photoURL'] = photoURL;
    }

    if (!existing) {
      patch['createdAt'] = serverTimestamp();
      patch['role'] = 'free';

      return patch;
    }

    this.copyExistingPublicField(existing, patch, 'createdAt');
    this.copyExistingPublicField(existing, patch, 'role');

    this.copyExistingPublicField(existing, patch, 'normalizedGender');
    this.copyExistingPublicField(existing, patch, 'normalizedOrientation');
    this.copyExistingPublicField(existing, patch, 'interestedInGenders');
    this.copyExistingPublicField(existing, patch, 'interestedInOrientations');
    this.copyExistingPublicField(existing, patch, 'compatibilityReady');
    this.copyExistingPublicField(existing, patch, 'discoveryNormalizedAt');

    return patch;
  }

  private copyExistingPublicField(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    field: string
  ): void {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      target[field] = source[field];
    }
  }

  private cleanText(value: unknown): string {
    return (value ?? '').toString().trim();
  }

  private cleanTextOrNull(value: unknown): string | null {
    const clean = this.cleanText(value);
    return clean || null;
  }

  private isHttpUrl(value: unknown): boolean {
    return /^https?:\/\//i.test(this.cleanText(value));
  }

  private safeHandle(
    msg: string,
    original: unknown,
    meta?: Record<string, unknown>,
    opts?: { silent?: boolean }
  ): void {
    try {
      const e = new Error(msg);

      (e as any).original = original;
      (e as any).meta = meta;

      const silent = opts?.silent === true;
      (e as any).silent = silent;

      if (silent) {
        (e as any).skipUserNotification = true;
      }

      this.globalErrorHandler.handleError(e);
    } catch {
      // noop
    }
  }
}
