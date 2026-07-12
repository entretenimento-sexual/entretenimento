import { Injectable } from '@angular/core';
import { Firestore, doc } from '@angular/fire/firestore';
import { serverTimestamp, writeBatch } from 'firebase/firestore';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Injectable({ providedIn: 'root' })
export class ProfileAvatarWriteService {
  constructor(
    private readonly db: Firestore,
    private readonly ctx: FirestoreContextService,
    private readonly globalErrorHandler: GlobalErrorHandlerService
  ) {}

  patchAvatar$(uid: string, photoURL: string): Observable<void> {
    const safeUid = String(uid ?? '').trim();
    const safePhotoURL = String(photoURL ?? '').trim();

    if (!safeUid) {
      return throwError(() => this.createError(
        'profile-avatar/invalid-uid',
        'UID inválido para atualizar o avatar.'
      ));
    }

    if (!/^https?:\/\//i.test(safePhotoURL)) {
      return throwError(() => this.createError(
        'profile-avatar/invalid-url',
        'URL de avatar inválida.'
      ));
    }

    const userRef = this.ctx.run(() => doc(this.db, 'users', safeUid));
    const publicProfileRef = this.ctx.run(() =>
      doc(this.db, 'public_profiles', safeUid)
    );

    return this.ctx.deferPromise$(async () => {
      const batch = writeBatch(this.db as any);
      const timestamp = serverTimestamp();

      batch.set(
        userRef as any,
        {
          photoURL: safePhotoURL,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      batch.set(
        publicProfileRef as any,
        {
          photoURL: safePhotoURL,
          updatedAt: timestamp,
        },
        { merge: true }
      );

      await batch.commit();
    }).pipe(
      map(() => void 0),
      catchError((error) => {
        this.reportError(error, safeUid);
        return throwError(() => error);
      })
    );
  }

  private createError(code: string, message: string): Error {
    const error = new Error(message);
    (error as any).code = code;
    return error;
  }

  private reportError(error: unknown, uid: string): void {
    try {
      const reportable = error instanceof Error
        ? error
        : new Error('[ProfileAvatarWriteService] Falha ao sincronizar avatar.');

      (reportable as any).context = 'ProfileAvatarWriteService';
      (reportable as any).operation = 'patchAvatar';
      (reportable as any).extra = { uid };
      (reportable as any).original = error;
      (reportable as any).skipUserNotification = true;

      this.globalErrorHandler.handleError(reportable);
    } catch {
      // noop
    }
  }
}
