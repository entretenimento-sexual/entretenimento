// src/app/core/services/data-handling/firestore/users/firestore-user-write.service.ts
// Não esqueça os comentários
import { Injectable } from '@angular/core';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs
} from '@angular/fire/firestore';
import { serverTimestamp } from 'firebase/firestore';
import { Observable, of, from } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import type { User } from 'firebase/auth';
import type { IUserDados } from '@core/interfaces/iuser-dados';
import type { IUserRegistrationData } from '@core/interfaces/iuser-registration-data';
import { FirestoreContextService } from './firestore/core/firestore-context.service';

@Injectable({ providedIn: 'root' })
export class FirestoreUserWriteService {
  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) { }

  /** Best-effort: garante /users/{uid} sem sobrescrever createdAt */
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
          : { ...payloadBase, createdAt: serverTimestamp() };

        return this.ctx.deferPromise$(() => setDoc(ref, payload as any, { merge: true })).pipe(
          map(() => void 0)
        );
      }),
      catchError((err) => {
        this.safeHandle('[FirestoreUserWriteService] ensureUserDoc falhou (ignorado).', err, { uid: authUser.uid });
        return of(void 0);
      })
    );
  }

  patchLastLogin$(uid: string): Observable<void> {
    const ref = this.ctx.run(() => doc(this.db, 'users', uid));
    return this.ctx.deferPromise$(() => setDoc(ref, { lastLogin: serverTimestamp() } as any, { merge: true })).pipe(
      map(() => void 0),
      catchError((err) => {
        this.safeHandle('[FirestoreUserWriteService] patchLastLogin falhou (ignorado).', err, { uid });
        return of(void 0);
      })
    );
  }

  patchEmailVerified$(uid: string, status: boolean): Observable<void> {
    const ref = this.ctx.run(() => doc(this.db, 'users', uid));
    return this.ctx.deferPromise$(() => updateDoc(ref, { emailVerified: status } as any)).pipe(
      map(() => void 0)
    );
  }

  patchEmailVerifiedByEmail$(email: string): Observable<void> {
    const qref = this.ctx.run(() =>
      query(collection(this.db, 'users'), where('email', '==', email))
    );

    return this.ctx.deferPromise$(() => getDocs(qref)).pipe(
      switchMap((snap) => {
        if (snap.empty) throw new Error('Usuário não encontrado pelo e-mail.');
        return from(Promise.all(snap.docs.map(d => updateDoc(d.ref, { emailVerified: true } as any))));
      }),
      map(() => void 0)
    );
  }

  /** substitui saveInitialUserData do legacy */
  saveInitialUserData$(uid: string, data: IUserRegistrationData): Observable<void> {
    const ref = this.ctx.run(() => doc(this.db, 'users', uid));
    return this.ctx.deferPromise$(() => setDoc(ref, data as any, { merge: true })).pipe(map(() => void 0));
  }

  private safeHandle(msg: string, original: unknown, meta?: Record<string, unknown>): void {
    try {
      const e = new Error(msg);
      (e as any).original = original;
      (e as any).meta = meta;
      this.globalErrorHandler.handleError(e);
    } catch { }
  }
}
