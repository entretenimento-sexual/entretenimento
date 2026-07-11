import { Injectable, inject } from '@angular/core';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  Observable,
  Subject,
  combineLatest,
  defer,
  from,
  of,
  throwError,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { AdultConsentRecord } from 'src/app/core/interfaces/compliance/adult-consent.interface';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FirestoreContextService } from 'src/app/core/services/data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  ADULT_CONSENT_VERSION,
  acceptAdultContentConsent,
  clearAdultContentConsent,
  hasAdultContentConsent,
} from 'src/app/core/guards/compliance/adult-content-consent.storage';

interface UserAdultConsentDocument {
  adultConsent?: Partial<AdultConsentRecord> | null;
}

@Injectable({ providedIn: 'root' })
export class AdultConsentService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly session = inject(AuthSessionService);
  private readonly firestoreContext = inject(FirestoreContextService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly refreshConsent$ = new Subject<void>();
  private readonly confirmedForSession = new Set<string>();
  private readonly acceptConsentCallable = httpsCallable<Record<string, never>, { ok: true; version: string }>(
    this.functions,
    'acceptAdultConsent'
  );

  readonly currentConsentAccepted$: Observable<boolean> = combineLatest([
    this.session.uid$.pipe(
      map((uid) => String(uid ?? '').trim()),
      distinctUntilChanged()
    ),
    this.refreshConsent$.pipe(startWith(void 0)),
  ]).pipe(
    switchMap(([uid]) => this.watchAcceptedForUser$(uid)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  watchAcceptedForUser$(uid: string): Observable<boolean> {
    const safeUid = String(uid ?? '').trim();

    if (!safeUid) {
      return of(false);
    }

    // O aceite confirmado nesta sessão já passou pela Cloud Function. Essa
    // memória evita uma janela de redirecionamento enquanto o listener do
    // Firestore recebe a atualização recém-gravada.
    if (this.confirmedForSession.has(safeUid)) {
      return of(true);
    }

    return this.firestoreContext.deferObservable$(() => {
      const userRef = doc(this.firestore, 'users', safeUid);
      return docData(userRef) as Observable<UserAdultConsentDocument | undefined>;
    }).pipe(
      map((document) => this.isConsentAccepted(document?.adultConsent)),
      tap((accepted) => {
        if (accepted) {
          this.confirmedForSession.add(safeUid);

          if (!acceptAdultContentConsent(safeUid)) {
            this.reportError(
              new Error('[AdultConsentService] local consent cache unavailable'),
              'persistConsentCache',
              { uid: safeUid }
            );
          }

          return;
        }

        this.confirmedForSession.delete(safeUid);
        clearAdultContentConsent(safeUid);
      }),
      catchError((error) => {
        this.reportError(error, 'watchAcceptedForUser', { uid: safeUid });

        // Em indisponibilidade temporária, somente um cache previamente
        // confirmado para este UID e esta versão pode manter a continuidade.
        return of(hasAdultContentConsent(safeUid));
      })
    );
  }

  acceptCurrentConsent$(): Observable<void> {
    return this.session.uid$.pipe(
      map((uid) => String(uid ?? '').trim()),
      take(1),
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

    return defer(() => from(this.acceptConsentCallable({}))).pipe(
      map((response) => {
        const result = response.data;

        if (result?.ok !== true || result.version !== ADULT_CONSENT_VERSION) {
          throw new Error('A confirmação retornou uma versão inválida.');
        }

        this.confirmedForSession.add(safeUid);

        if (!acceptAdultContentConsent(safeUid)) {
          this.reportError(
            new Error('[AdultConsentService] local consent cache unavailable'),
            'persistConsentCacheAfterAcceptance',
            { uid: safeUid }
          );
        }

        this.refreshConsent$.next();
        return undefined;
      }),
      catchError((error) => {
        this.reportError(error, 'acceptForUser', { uid: safeUid });
        return throwError(() => error);
      })
    );
  }

  clearCurrentConsentCache$(): Observable<void> {
    return this.session.uid$.pipe(
      map((uid) => String(uid ?? '').trim()),
      take(1),
      map((uid) => {
        if (uid) {
          this.confirmedForSession.delete(uid);
          clearAdultContentConsent(uid);
        }

        return undefined;
      })
    );
  }

  private isConsentAccepted(record: Partial<AdultConsentRecord> | null | undefined): boolean {
    return record?.accepted === true && record.version === ADULT_CONSENT_VERSION;
  }

  private reportError(error: unknown, operation: string, extra: Record<string, unknown>): void {
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
