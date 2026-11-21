// src/app/core/services/data-handling/firestore-user-write.service.ts
import { Injectable } from '@angular/core';

import {
  Firestore,
  collection,
  doc,
  query,
  where,
} from '@angular/fire/firestore';

import {
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import type { IUserDados } from '@core/interfaces/iuser-dados';

import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { FirestoreContextService } from './firestore/core/firestore-context.service';

@Injectable({ providedIn: 'root' })
export class FirestoreUserWriteService {
  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  patchLastLogin$(uid: string): Observable<void> {
    const safeUid = (uid ?? '').trim();

    if (!safeUid) {
      return of(void 0);
    }

    const ref = this.ctx.run(() => doc(this.db, 'users', safeUid));

    return this.ctx
      .deferPromise$(() =>
        updateDoc(ref, { lastLogin: serverTimestamp() })
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
        updateDoc(ref as any, {
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

    return this.ctx.deferPromise$(() => getDocs(qref as any)).pipe(
      switchMap((snap) => {
        if (snap.empty) {
          throw new Error('Usuário não encontrado pelo e-mail.');
        }

        return from(
          Promise.all(
            snap.docs.map((d) =>
              updateDoc(d.ref as any, {
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
        userRef as any,
        { photoURL: safePhotoURL } as any,
        { merge: true }
      );

      try {
        await setDoc(
          publicProfileRef as any,
          {
            photoURL: safePhotoURL,
            updatedAt: serverTimestamp(),
          } as any,
          { merge: true }
        );
      } catch (err) {
        this.safeHandle(
          '[FirestoreUserWriteService] Avatar salvo no perfil privado, mas não sincronizado no public_profiles.',
          err,
          { uid: safeUid },
          { silent: true }
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

  private cleanText(value: unknown): string {
    return (value ?? '').toString().trim();
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
