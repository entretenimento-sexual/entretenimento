// src/app/core/services/compliance/adult-consent.service.ts
// -----------------------------------------------------------------------------
// AdultConsentService
// -----------------------------------------------------------------------------
// Lê e grava o aceite adulto no documento privado do usuário.
//
// Decisão:
// - Firestore é a trilha persistida por uid;
// - localStorage permanece cache/UX local;
// - falhas técnicas são enviadas ao GlobalErrorHandlerService;
// - o aceite local ainda permite seguir quando a rede falha temporariamente.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  doc,
  docData,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { Observable, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  tap,
} from 'rxjs/operators';

import { AdultConsentRecord } from 'src/app/core/interfaces/compliance/adult-consent.interface';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  ADULT_CONSENT_VERSION,
  acceptAdultContentConsent,
  hasAdultContentConsent,
} from 'src/app/core/guards/compliance/adult-content-consent.storage';

interface UserAdultConsentDocument {
  adultConsent?: Partial<AdultConsentRecord> | null;
}

@Injectable({ providedIn: 'root' })
export class AdultConsentService {
  private readonly firestore = inject(Firestore);
  private readonly session = inject(AuthSessionService);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  readonly currentConsentAccepted$: Observable<boolean> = this.session.uid$.pipe(
    map((uid) => String(uid ?? '').trim()),
    distinctUntilChanged(),
    switchMap((uid) => this.watchAcceptedForUser$(uid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  watchAcceptedForUser$(uid: string): Observable<boolean> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return of(hasAdultContentConsent());
    }

    if (hasAdultContentConsent()) {
      return of(true);
    }

    return this.firestoreContext.deferObservable$(() => {
      const userRef = doc(this.firestore, 'users', safeUid);
      return docData(userRef) as Observable<UserAdultConsentDocument | undefined>;
    }).pipe(
      map((document) => this.isConsentAccepted(document?.adultConsent)),
      tap((accepted) => {
        if (accepted) {
          acceptAdultContentConsent();
        }
      }),
      catchError((error) => {
        this.reportError(error, 'watchAcceptedForUser', { uid: safeUid });
        return of(hasAdultContentConsent());
      })
    );
  }

  acceptCurrentConsent$(): Observable<void> {
    return this.session.uid$.pipe(
      map((uid) => String(uid ?? '').trim()),
      switchMap((uid) => {
        if (!uid) {
          return throwError(() => new Error('Usuário não autenticado.'));
        }

        return this.acceptForUser$(uid);
      })
    );
  }

  acceptForUser$(uid: string): Observable<void> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return throwError(() => new Error('UID inválido.'));
    }

    return this.firestoreContext.deferPromise$(() => {
      const userRef = doc(this.firestore, 'users', safeUid);

      return setDoc(
        userRef,
        {
          uid: safeUid,
          adultConsent: {
            accepted: true,
            version: ADULT_CONSENT_VERSION,
            acceptedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            source: 'web',
          },
        },
        { merge: true }
      );
    }).pipe(
      tap(() => {
        acceptAdultContentConsent();
      }),
      map(() => undefined),
      catchError((error) => {
        this.reportError(error, 'acceptForUser', { uid: safeUid });
        return throwError(() => error);
      })
    );
  }

  private isConsentAccepted(record: Partial<AdultConsentRecord> | null | undefined): boolean {
    return record?.accepted === true && record.version === ADULT_CONSENT_VERSION;
  }

  private reportError(
    error: unknown,
    operation: string,
    extra: Record<string, unknown>
  ): void {
    try {
      const err = error instanceof Error
        ? error
        : new Error('[AdultConsentService] operation failed');

      (err as any).context = 'AdultConsentService';
      (err as any).operation = operation;
      (err as any).extra = extra;
      (err as any).original = error;
      (err as any).skipUserNotification = true;

      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
}
