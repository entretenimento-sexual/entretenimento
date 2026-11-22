// src/app/core/services/compliance/age-eligibility.service.ts
// -----------------------------------------------------------------------------
// AGE ELIGIBILITY CLIENT PROJECTION
// -----------------------------------------------------------------------------
// Observa a projeção sanitizada de users/{uid}.ageEligibility.
// A projeção nunca é autoridade de segurança. Ela serve à UX e é reconciliada
// silenciosamente com o backend. SELF_DECLARED_ADULT pode existir como evidência,
// a admissão 18+ permite autodeclaração canônica; VERIFIED_ADULT eleva assurance.
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
  defer,
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
  state: IUserAgeEligibility | null;
  registrationRequiresTrustedVerification: boolean;
}

@Injectable({ providedIn: 'root' })
export class AgeEligibilityService {
  private readonly trustedSessionProjection =
    new BehaviorSubject<TrustedSessionAgeProjection | null>(null);
  private reconciledUid: string | null = null;
  private sessionGeneration = 0;
  private reconcileInFlight:
    | { uid: string; stream: Observable<IUserAgeEligibility> }
    | null = null;

  constructor(
    private readonly environmentInjector: EnvironmentInjector,
    private readonly currentUser: CurrentUserStoreService,
    private readonly globalError: GlobalErrorHandlerService,
  ) {
    this.currentUser.getLoggedUserUID$().pipe(distinctUntilChanged()).subscribe(() => {
      this.sessionGeneration++;
      this.reconciledUid = null;
      this.reconcileInFlight = null;
      if (this.trustedSessionProjection.value !== null) {
        this.trustedSessionProjection.next(null);
      }
    });
  }

  readonly current$: Observable<IUserAgeEligibility> =
    combineLatest([
      this.currentUser.getLoggedUserUID$(),
      this.currentUser.user$,
      this.trustedSessionProjection,
    ]).pipe(
      map(([uid, user, trusted]) => {
        const persisted = this.normalize(uid && user?.uid === uid ? user.ageEligibility : null);

        const active = uid && trusted?.uid === uid ? trusted : null;
        const state = active?.state;
        const latest = state && (state.updatedAtMs ?? 0) >= (persisted.updatedAtMs ?? 0)
          ? state
          : persisted;

        return active?.registrationRequiresTrustedVerification
          ? { ...latest, registrationRequiresTrustedVerification: true }
          : latest;
      }),
      distinctUntilChanged(
        (left, right) =>
          left.status === right.status &&
          left.registrationRequiresTrustedVerification === right.registrationRequiresTrustedVerification &&
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
    return defer(() => {
      const uid = this.currentUser.getLoggedUserUIDSnapshot();
      if (!uid) throw new Error('Entre para consultar sua elegibilidade etária.');
      const generation = this.sessionGeneration;

      const callable = runInInjectionContext(
        this.environmentInjector,
        () => httpsCallable<
          Record<string, never>,
          {
            status: IUserAgeEligibility['status'];
            migrated: boolean;
            restoredFromDeclarationEvidence: boolean;
            ageEligibility: IUserAgeEligibility | null;
            registrationRequiresTrustedVerification?: boolean;
          }
        >(
          inject(Functions),
          'refreshMyAgeEligibility'
        )
      );

      return from(callable({})).pipe(
        map(({ data }) => {
          this.assertCurrentSession(uid, generation);
          const state = this.normalize(data.ageEligibility);
          const registrationRequiresTrustedVerification = data.registrationRequiresTrustedVerification === true;

          if (state.status !== 'UNVERIFIED' || registrationRequiresTrustedVerification) {
            this.trustedSessionProjection.next({
              uid,
              state: state.status === 'UNVERIFIED' ? null : state,
              registrationRequiresTrustedVerification,
            });
          } else if (this.trustedSessionProjection.value?.uid === uid) {
            this.trustedSessionProjection.next(null);
          }

          this.reconciledUid = uid;
          return data.status;
        })
      );
    }).pipe(
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

    const generation = this.sessionGeneration;
    const stream = defer(() => {
      this.assertCurrentSession(uid, generation);
      return this.refreshTrustedSources$();
    }).pipe(
      switchMap(() => this.getCurrentOnce$()),
      tap(() => {
        this.assertCurrentSession(uid, generation);
        this.reconciledUid = uid;
      }),
      finalize(() => {
        if (this.reconcileInFlight?.stream === stream) {
          this.reconcileInFlight = null;
        }
      }),
      // Ao sair da etapa, libera uma consulta pendente sem outros consumidores
      // para que a próxima tentativa possa consultar a autoridade novamente.
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.reconcileInFlight = { uid, stream };
    return stream;
  }


  acceptSelfDeclaration$(): Observable<
    'SELF_DECLARED_ADULT' | 'VERIFIED_ADULT'
  > {
    return defer(() => {
      const uid = this.currentUser.getLoggedUserUIDSnapshot();
      if (!uid) throw new Error('Entre para confirmar sua maioridade.');
      const generation = this.sessionGeneration;

      const callable = runInInjectionContext(
        this.environmentInjector,
        () => httpsCallable<
          { confirmsAdult: true; expectedUid: string },
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

      return from(callable({ confirmsAdult: true, expectedUid: uid })).pipe(
        map(({ data }) => {
          this.assertCurrentSession(uid, generation);
          if (data.uid !== uid) throw new Error('Confirmação vinculada a outra conta.');
          const state = this.normalize(data.ageEligibility);

          if (state.status === 'SELF_DECLARED_ADULT' || state.status === 'VERIFIED_ADULT') {
            this.trustedSessionProjection.next({ uid, state, registrationRequiresTrustedVerification: false });
          }

          return data.status;
        })
      );
    }).pipe(
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
                skipUserNotification: true,
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

  private assertCurrentSession(uid: string, generation: number): void {
    if (this.sessionGeneration !== generation || this.currentUser.getLoggedUserUIDSnapshot() !== uid) {
      throw Object.assign(new Error('A conta ativa mudou durante a verificação de idade.'), {
        code: 'auth/session-changed',
      });
    }
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
