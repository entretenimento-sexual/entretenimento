// src/app/core/services/compliance/age-eligibility.service.ts
// -----------------------------------------------------------------------------
// AGE ELIGIBILITY CLIENT PROJECTION
// -----------------------------------------------------------------------------
// Observa somente a projeção sanitizada de users/{uid}.ageEligibility.
// A autodeclaração só libera acesso quando já foi registrada pelo backend como
// DECLARED_ADULT/SELF_ATTESTED. O cliente nunca promove o próprio estado.
// -----------------------------------------------------------------------------

import {
  EnvironmentInjector,
  Injectable,
  inject,
  runInInjectionContext,
} from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, concat, from, of, throwError, timer } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
} from 'rxjs/operators';

import {
  IUserAgeEligibility,
} from 'src/app/core/interfaces/iuser-dados';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { toErrorInstance } from 'src/app/core/utils/firebase-error-utils';

const UNVERIFIED: IUserAgeEligibility = Object.freeze({
  status: 'UNVERIFIED',
  policyVersion: 0,
  source: 'INITIAL_VERIFICATION',
  method: 'MANUAL_REVIEW',
  caseId: null,
  verifiedAtMs: null,
  expiresAtMs: null,
  updatedAtMs: null,
});

@Injectable({ providedIn: 'root' })
export class AgeEligibilityService {
  constructor(
    private readonly environmentInjector: EnvironmentInjector,
    private readonly currentUser: CurrentUserStoreService,
    private readonly globalError: GlobalErrorHandlerService,
  ) {}

  readonly current$: Observable<IUserAgeEligibility> =
    this.currentUser.user$.pipe(
      map((user) => this.normalize(user?.ageEligibility)),
      distinctUntilChanged(
        (left, right) =>
          left.status === right.status &&
          left.policyVersion === right.policyVersion &&
          left.source === right.source &&
          left.method === right.method &&
          left.caseId === right.caseId &&
          left.verifiedAtMs === right.verifiedAtMs &&
          left.expiresAtMs === right.expiresAtMs &&
          left.updatedAtMs === right.updatedAtMs
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * Gate operacional atual da experiência adulta.
   *
   * DECLARED_ADULT é suficiente enquanto a política transitória aceita
   * autodeclaração. VERIFIED_ADULT continua reservado para prova forte.
   */
  readonly adultAccessAllowed$: Observable<boolean> = this.current$.pipe(
    switchMap((state) => this.observeAdultAccessWindow$(state)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Sinal estrito de prova forte. Não usar como sinônimo de acesso social.
   */
  readonly verifiedAdult$: Observable<boolean> = this.current$.pipe(
    switchMap((state) => this.observeVerifiedWindow$(state)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  getCurrentOnce$(): Observable<IUserAgeEligibility> {
    return this.current$.pipe(take(1));
  }

  refreshTrustedSources$(): Observable<IUserAgeEligibility['status']> {
    const callable = runInInjectionContext(
      this.environmentInjector,
      () => httpsCallable<
        Record<string, never>,
        {
          status: IUserAgeEligibility['status'];
          migrated: boolean;
        }
      >(
        inject(Functions),
        'refreshMyAgeEligibility'
      )
    );

    return from(callable({})).pipe(
      map((response) => response.data.status),
      catchError((error) => {
        try {
          this.globalError.handleError(
            Object.assign(
              toErrorInstance(
                error,
                '[AgeEligibilityService.refreshTrustedSources] falhou.'
              ),
              {
                feature: 'age-eligibility',
                operation: 'refreshTrustedSources',
                context: {
                  scope: 'AgeEligibilityService',
                },
                original: error,
              }
            )
          );
        } catch {
          // Diagnóstico não altera a fronteira etária.
        }

        return throwError(() => error);
      })
    );
  }


  submitSelfAttestation$(): Observable<{
    status: 'DECLARED_ADULT' | 'VERIFIED_ADULT';
    assuranceLevel: 'SELF_ATTESTED' | 'VERIFIED';
  }> {
    const callable = runInInjectionContext(
      this.environmentInjector,
      () => httpsCallable<
        {
          declaredAdult: true;
          attestationVersion: 1;
        },
        {
          status: 'DECLARED_ADULT' | 'VERIFIED_ADULT';
          assuranceLevel: 'SELF_ATTESTED' | 'VERIFIED';
        }
      >(
        inject(Functions),
        'submitAdultSelfAttestation'
      )
    );

    return from(
      callable({
        declaredAdult: true,
        attestationVersion: 1,
      })
    ).pipe(
      map((response) => response.data),
      catchError((error) => {
        try {
          this.globalError.handleError(
            Object.assign(
              toErrorInstance(
                error,
                '[AgeEligibilityService.submitSelfAttestation] falhou.'
              ),
              {
                feature: 'age-eligibility',
                operation: 'submitSelfAttestation',
                context: {
                  scope: 'AgeEligibilityService',
                },
                original: error,
              }
            )
          );
        } catch {
          // Diagnóstico não altera a fronteira etária.
        }

        return throwError(() => error);
      })
    );
  }

  requestInitialReview$(): Observable<{
    reportId: string | null;
    status: 'VERIFIED_ADULT' | 'REVIEW_REQUIRED';
  }> {
    const callable = runInInjectionContext(
      this.environmentInjector,
      () => httpsCallable<
        Record<string, never>,
        {
          reportId: string | null;
          status: 'VERIFIED_ADULT' | 'REVIEW_REQUIRED';
        }
      >(
        inject(Functions),
        'requestInitialAgeVerificationReview'
      )
    );

    return from(callable({})).pipe(
      map((response) => response.data),
      catchError((error) => {
        try {
          this.globalError.handleError(
            Object.assign(
              toErrorInstance(
                error,
                '[AgeEligibilityService.requestInitialReview] falhou.'
              ),
              {
                feature: 'age-eligibility',
                operation: 'requestInitialReview',
                context: {
                  scope: 'AgeEligibilityService',
                },
                original: error,
              }
            )
          );
        } catch {
          // Diagnóstico não altera a fronteira etária.
        }

        return throwError(() => error);
      })
    );
  }

  private observeAdultAccessWindow$(
    state: IUserAgeEligibility
  ): Observable<boolean> {
    if (
      state.status === 'DECLARED_ADULT' &&
      state.policyVersion === 1 &&
      state.source === 'SELF_ATTESTATION' &&
      state.method === 'SELF_ATTESTATION' &&
      state.assuranceLevel === 'SELF_ATTESTED'
    ) {
      return of(true);
    }

    return this.observeVerifiedWindow$(state);
  }

  private observeVerifiedWindow$(
    state: IUserAgeEligibility
  ): Observable<boolean> {
    const now = Date.now();
    const active = this.isVerifiedAdultAt(state, now);
    const futureBoundaries = [
      state.verifiedAtMs,
      state.expiresAtMs,
    ].filter(
      (value): value is number =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value > now
    );

    if (futureBoundaries.length === 0) {
      return of(active);
    }

    const nextBoundary = Math.min(...futureBoundaries);
    const delayMs = Math.max(1, nextBoundary - now + 1);

    return concat(
      of(active),
      timer(delayMs).pipe(
        switchMap(() => this.observeVerifiedWindow$(state))
      )
    );
  }

  private isVerifiedAdultAt(
    state: IUserAgeEligibility,
    now: number
  ): boolean {
    if (
      state.status !== 'VERIFIED_ADULT' ||
      state.policyVersion !== 1
    ) {
      return false;
    }

    if (
      state.verifiedAtMs != null &&
      state.verifiedAtMs > now
    ) {
      return false;
    }

    return (
      state.expiresAtMs == null ||
      now < state.expiresAtMs
    );
  }

  private normalize(
    raw: IUserAgeEligibility | null | undefined
  ): IUserAgeEligibility {
    if (!raw || typeof raw !== 'object') {
      return UNVERIFIED;
    }

    const status = raw.status;
    const source = raw.source;
    const method = raw.method;
    const policyVersion = Number(raw.policyVersion);

    if (
      ![
        'UNVERIFIED',
        'DECLARED_ADULT',
        'REVIEW_REQUIRED',
        'VERIFIED_ADULT',
        'DENIED_UNDERAGE',
        'EXPIRED',
      ].includes(status) ||
      ![
        'SELF_ATTESTATION',
        'INITIAL_VERIFICATION',
        'AGE_REVERIFICATION',
        'PROFILE_KYC',
        'MIGRATION',
      ].includes(source) ||
      ![
        'SELF_ATTESTATION',
        'EXTERNAL_PROVIDER',
        'MANUAL_REVIEW',
        'KYC',
        'MIGRATED_REVIEW',
      ].includes(method) ||
      !Number.isInteger(policyVersion) ||
      policyVersion < 1
    ) {
      return UNVERIFIED;
    }

    return {
      status,
      policyVersion,
      source,
      method,
      assuranceLevel:
        raw.assuranceLevel === 'SELF_ATTESTED' ||
        raw.assuranceLevel === 'VERIFIED' ||
        raw.assuranceLevel === 'NONE'
          ? raw.assuranceLevel
          : status === 'DECLARED_ADULT' && method === 'SELF_ATTESTATION'
            ? 'SELF_ATTESTED'
            : status === 'VERIFIED_ADULT'
              ? 'VERIFIED'
              : 'NONE',
      caseId: String(raw.caseId ?? '').trim() || null,
      verifiedAtMs: this.safeTime(raw.verifiedAtMs),
      expiresAtMs: this.safeTime(raw.expiresAtMs),
      updatedAtMs: this.safeTime(raw.updatedAtMs),
    };
  }

  private safeTime(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.trunc(parsed)
      : null;
  }
}
