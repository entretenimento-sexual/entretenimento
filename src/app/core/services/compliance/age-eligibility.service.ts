// src/app/core/services/compliance/age-eligibility.service.ts
// -----------------------------------------------------------------------------
// AGE ELIGIBILITY CLIENT PROJECTION
// -----------------------------------------------------------------------------
// Observa a projeção sanitizada de users/{uid}.ageEligibility.
// A projeção nunca é autoridade de segurança. Ela serve à UX e é reconciliada
// silenciosamente com o backend. SELF_DECLARED_ADULT pode existir como evidência,
// mas somente VERIFIED_ADULT confiável libera a experiência adulta.
// -----------------------------------------------------------------------------

import {
  EnvironmentInjector,
  Injectable,
  inject,
  runInInjectionContext,
} from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  from,
  throwError,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
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

interface TrustedSessionAgeProjection {
  uid: string;
  state: IUserAgeEligibility;
}

@Injectable({ providedIn: 'root' })
export class AgeEligibilityService {
  private readonly trustedSessionProjection =
    new BehaviorSubject<TrustedSessionAgeProjection | null>(null);
  private reconciledUid: string | null = null;
  private reconcileInFlight:
    | { uid: string; stream: Observable<IUserAgeEligibility> }
    | null = null;

  constructor(
    private readonly environmentInjector: EnvironmentInjector,
    private readonly currentUser: CurrentUserStoreService,
    private readonly globalError: GlobalErrorHandlerService,
  ) {
    this.currentUser.user$.subscribe((user) => {
      const uid = String(user?.uid ?? '').trim();

      if (!uid) {
        this.reconciledUid = null;
        this.reconcileInFlight = null;
        if (this.trustedSessionProjection.value !== null) {
          this.trustedSessionProjection.next(null);
        }
        return;
      }

      if (this.reconciledUid && this.reconciledUid !== uid) {
        this.reconciledUid = null;
        this.reconcileInFlight = null;
      }

      if (
        this.trustedSessionProjection.value &&
        this.trustedSessionProjection.value.uid !== uid
      ) {
        this.trustedSessionProjection.next(null);
      }
    });
  }

  private readonly sessionUser$ = this.currentUser.user$;

  readonly current$: Observable<IUserAgeEligibility> =
    combineLatest([
      this.sessionUser$,
      this.trustedSessionProjection,
    ]).pipe(
      map(([user, trusted]) => {
        const persisted = this.normalize(user?.ageEligibility);
        const uid = String(user?.uid ?? '').trim();

        if (
          uid &&
          trusted?.uid === uid &&
          (trusted.state.updatedAtMs ?? 0) >=
            (persisted.updatedAtMs ?? 0)
        ) {
          return trusted.state;
        }

        return persisted;
      }),
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
          restoredFromDeclarationEvidence: boolean;
          ageEligibility: IUserAgeEligibility | null;
        }
      >(
        inject(Functions),
        'refreshMyAgeEligibility'
      )
    );

    return from(callable({})).pipe(
      map((response) => {
        const uid = String(
          this.currentUser.getLoggedUserUIDSnapshot() ?? ''
        ).trim();
        const state = response.data.ageEligibility
          ? this.normalize(response.data.ageEligibility)
          : null;

        if (uid && state && state.status !== 'UNVERIFIED') {
          this.trustedSessionProjection.next({ uid, state });
        } else if (
          uid &&
          this.trustedSessionProjection.value?.uid === uid
        ) {
          this.trustedSessionProjection.next(null);
        }

        return response.data.status;
      }),
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


  /**
   * Reconcilia silenciosamente a autoridade backend no máximo uma vez por
   * UID/sessão. Não cria novo consentimento nem pede confirmação ao usuário.
   */
  reconcileTrustedStateOncePerSession$(): Observable<IUserAgeEligibility> {
    const uid = String(
      this.currentUser.getLoggedUserUIDSnapshot() ?? ''
    ).trim();

    if (!uid) {
      return this.getCurrentOnce$();
    }

    if (this.reconciledUid === uid) {
      return this.getCurrentOnce$();
    }

    if (this.reconcileInFlight?.uid === uid) {
      return this.reconcileInFlight.stream;
    }

    const stream = this.refreshTrustedSources$().pipe(
      switchMap(() => this.getCurrentOnce$()),
      tap(() => {
        this.reconciledUid = uid;
      }),
      finalize(() => {
        if (this.reconcileInFlight?.uid === uid) {
          this.reconcileInFlight = null;
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.reconcileInFlight = { uid, stream };
    return stream;
  }


  acceptSelfDeclaration$(): Observable<
    'SELF_DECLARED_ADULT' | 'VERIFIED_ADULT'
  > {
    const callable = runInInjectionContext(
      this.environmentInjector,
      () => httpsCallable<
        { confirmsAdult: true },
        {
          uid: string;
          status: 'SELF_DECLARED_ADULT' | 'VERIFIED_ADULT';
          declaredAtMs: number | null;
          ageEligibility: IUserAgeEligibility;
        }
      >(
        inject(Functions),
        'acceptAdultSelfDeclaration'
      )
    );

    return from(callable({ confirmsAdult: true })).pipe(
      map((response) => {
        const uid = String(response.data.uid ?? '').trim();
        const state = this.normalize(response.data.ageEligibility);

        if (
          uid &&
          (
            state.status === 'SELF_DECLARED_ADULT' ||
            state.status === 'VERIFIED_ADULT'
          )
        ) {
          this.trustedSessionProjection.next({ uid, state });
        }

        return response.data.status;
      }),
      catchError((error) => {
        try {
          this.globalError.handleError(
            Object.assign(
              toErrorInstance(
                error,
                '[AgeEligibilityService.acceptSelfDeclaration] falhou.'
              ),
              {
                feature: 'age-eligibility',
                operation: 'acceptSelfDeclaration',
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
    status:
      | 'VERIFIED_ADULT'
      | 'REVIEW_REQUIRED';
  }> {
    const callable = runInInjectionContext(
      this.environmentInjector,
      () => httpsCallable<
        Record<string, never>,
        {
          reportId: string | null;
          status:
            | 'VERIFIED_ADULT'
            | 'REVIEW_REQUIRED';
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
        'SELF_DECLARED_ADULT',
        'REVIEW_REQUIRED',
        'VERIFIED_ADULT',
        'DENIED_UNDERAGE',
        'EXPIRED',
      ].includes(status) ||
      ![
        'SELF_DECLARATION',
        'INITIAL_VERIFICATION',
        'AGE_REVERIFICATION',
        'PROFILE_KYC',
        'MIGRATION',
      ].includes(source) ||
      ![
        'SELF_DECLARATION',
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
