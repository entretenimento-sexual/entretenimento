// src/app/core/services/data-handling/firestore-user-write.service.ts
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
      .pipe(map(() => void 0));
  }

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

  patchProfileAvatar$(uid: string, photoURL: string): Observable<void> {
    const safeUid = (uid ?? '').trim();
    const safePhotoURL = this.cleanText(photoURL);

    if (!safeUid) {
      return throwError(() => new Error('[FirestoreUserWriteService] UID inválido.'));
    }

    if (!this.isHttpUrl(safePhotoURL)) {
      return throwError(() => new Error('[FirestoreUserWriteService] URL de foto inválida.'));
    }

    const userRef = this.ctx.run(() => doc(this.db, 'users', safeUid));
    const publicProfileRef = this.ctx.run(() =>
      doc(this.db, 'public_profiles', safeUid)
    );

    return this.ctx.deferPromise$(async () => {
      await setDoc(
        userRef,
        { photoURL: safePhotoURL } as any,
        { merge: true }
      );

      try {
        const publicProfileSnap = await getDoc(publicProfileRef);
        const existingPublicProfile = publicProfileSnap.exists()
          ? (publicProfileSnap.data() as Record<string, unknown>)
          : null;

        await setDoc(
          publicProfileRef,
          this.buildPublicProfileAvatarPatch(
            safeUid,
            safePhotoURL,
            existingPublicProfile
          ) as any
        );
      } catch (err) {
        console.warn(
          '[FirestoreUserWriteService] Avatar salvo no perfil privado, mas não sincronizado no public_profiles.',
          { uid: safeUid, error: err }
        );
      }
    }).pipe(map(() => void 0));
  }

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

    this.copyExistingPublicServerFields(existing, patch);

    return patch;
  }

  private buildPublicProfileAvatarPatch(
    uid: string,
    photoURL: string,
    existing: Record<string, unknown> | null
  ): Record<string, unknown> {
    const patch: Record<string, unknown> = {
      uid,
      photoURL,
      updatedAt: serverTimestamp(),
    };

    if (!existing) {
      patch['createdAt'] = serverTimestamp();
      patch['role'] = 'free';
      return patch;
    }

    const nickname = this.cleanText(existing['nickname']);
    if (nickname.length >= 3 && nickname.length <= 40) {
      patch['nickname'] = nickname;

      const existingNormalized = this.cleanText(existing['nicknameNormalized']);
      patch['nicknameNormalized'] = existingNormalized ||
        NicknameUtils.normalizarApelidoParaIndice(nickname);
    }

    this.copyOptionalText(existing, patch, 'gender');
    this.copyOptionalText(existing, patch, 'orientation');
    this.copyOptionalText(existing, patch, 'estado');
    this.copyOptionalText(existing, patch, 'municipio');
    this.copyOptionalHttpUrl(existing, patch, 'avatarUrl');

    this.copyCoherentGeo(existing, patch);
    this.copyExistingPublicServerFields(existing, patch);

    return patch;
  }

  private copyExistingPublicServerFields(
    source: Record<string, unknown>,
    target: Record<string, unknown>
  ): void {
    this.copyExistingPublicField(source, target, 'createdAt');
    this.copyExistingPublicField(source, target, 'role');
    this.copyExistingPublicField(source, target, 'normalizedGender');
    this.copyExistingPublicField(source, target, 'normalizedOrientation');
    this.copyExistingPublicField(source, target, 'interestedInGenders');
    this.copyExistingPublicField(source, target, 'interestedInOrientations');
    this.copyExistingPublicField(source, target, 'compatibilityReady');
    this.copyExistingPublicField(source, target, 'discoveryNormalizedAt');
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

  private copyOptionalText(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    field: string
  ): void {
    const text = this.cleanText(source[field]);

    if (text) {
      target[field] = text;
    }
  }

  private copyOptionalHttpUrl(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    field: string
  ): void {
    const value = this.cleanText(source[field]);

    if (this.isHttpUrl(value)) {
      target[field] = value;
    }
  }

  private copyCoherentGeo(
    source: Record<string, unknown>,
    target: Record<string, unknown>
  ): void {
    const latitude = this.toOptionalNumber(source['latitude']);
    const longitude = this.toOptionalNumber(source['longitude']);
    const geohash = this.cleanText(source['geohash']);

    if (latitude === null || longitude === null || !geohash) {
      return;
    }

    target['latitude'] = latitude;
    target['longitude'] = longitude;
    target['geohash'] = geohash;
  }

  private toOptionalNumber(value: unknown): number | null {
    const n =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    return Number.isFinite(n) ? n : null;
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
