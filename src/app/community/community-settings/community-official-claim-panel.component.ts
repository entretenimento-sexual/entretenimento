import { AsyncPipe, DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  catchError,
  combineLatest,
  defer,
  exhaustMap,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  tap,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  buildCommunityOfficialClaimCapabilityCandidateKey,
  type CommunityOfficialClaimCapabilityCandidate,
  type CommunityOfficialClaimCapabilityResponse,
} from '../data-access/community-official-claim-capability.model';
import type {
  CommunityOfficialClaimStatus,
  CommunityOfficialClaimView,
} from '../data-access/community-official-claim.model';
import { CommunityOfficialClaimRepository } from '../data-access/community-official-claim.repository';

type CapabilityState =
  | { status: 'loading'; capability: null }
  | { status: 'ready'; capability: CommunityOfficialClaimCapabilityResponse }
  | { status: 'error'; capability: null };

type ClaimState =
  | { status: 'idle'; claim: null }
  | { status: 'loading'; claim: null }
  | { status: 'ready'; claim: CommunityOfficialClaimView | null }
  | { status: 'error'; claim: null };

type SubmissionState = 'idle' | 'loading';

@Component({
  selector: 'app-community-official-claim-panel',
  standalone: true,
  imports: [AsyncPipe, DatePipe, NgTemplateOutlet, ReactiveFormsModule],
  templateUrl: './community-official-claim-panel.component.html',
  styleUrl: './community-official-claim-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityOfficialClaimPanelComponent {
  private readonly repository = inject(CommunityOfficialClaimRepository);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly capabilityReload$ = new Subject<void>();
  private readonly claimReload$ = new Subject<void>();
  private readonly submissionRequests$ =
    new Subject<CommunityOfficialClaimCapabilityCandidate>();

  readonly communityId = input.required<string>();
  readonly targetKey = new FormControl('', { nonNullable: true });
  readonly authorizationAccepted = new FormControl(false, { nonNullable: true });

  private latestCapability: CommunityOfficialClaimCapabilityResponse | null = null;
  private latestClaim: CommunityOfficialClaimView | null = null;

  readonly capabilityState$: Observable<CapabilityState> = combineLatest([
    toObservable(this.communityId),
    this.capabilityReload$.pipe(startWith(undefined)),
  ]).pipe(
    switchMap(([communityId]) =>
      this.repository
        .getCommunityOfficialClaimCapability$(communityId)
        .pipe(
          tap((capability) => {
            this.latestCapability = capability;
            const currentTargetKey = this.targetKey.value;
            const currentStillAvailable = capability.candidates.some(
              (candidate) => this.candidateKey(candidate) === currentTargetKey
            );
            const onlyCandidate = capability.candidates.length === 1
              ? capability.candidates[0]
              : null;
            const nextTargetKey = currentStillAvailable
              ? currentTargetKey
              : onlyCandidate
                ? this.candidateKey(onlyCandidate)
                : '';

            if (nextTargetKey !== currentTargetKey) {
              this.targetKey.setValue(nextTargetKey);
            }
          }),
          map((capability): CapabilityState => ({
            status: 'ready',
            capability,
          })),
          catchError((error: unknown) => {
            this.latestCapability = null;
            this.reportError(
              error,
              'getCommunityOfficialClaimCapability',
              'Não foi possível consultar os vínculos disponíveis para Comunidade Oficial.'
            );
            return of<CapabilityState>({ status: 'error', capability: null });
          }),
          startWith<CapabilityState>({ status: 'loading', capability: null })
        )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly claimState$: Observable<ClaimState> = combineLatest([
    this.capabilityState$,
    defer(() => this.targetKey.valueChanges.pipe(startWith(this.targetKey.value))),
    this.claimReload$.pipe(startWith(undefined)),
  ]).pipe(
    switchMap(([capabilityState, targetKey]) => {
      if (capabilityState.status !== 'ready' || !targetKey) {
        this.latestClaim = null;
        return of<ClaimState>({ status: 'idle', claim: null });
      }

      const candidate = capabilityState.capability.candidates.find(
        (item) => this.candidateKey(item) === targetKey
      );
      if (!candidate) {
        this.latestClaim = null;
        return of<ClaimState>({ status: 'idle', claim: null });
      }

      return this.repository.getMyCommunityOfficialClaim$(candidate.target).pipe(
        tap((response) => {
          this.latestClaim = response.claim?.communityId === this.communityId().trim()
            ? response.claim
            : null;
        }),
        map((response): ClaimState => ({
          status: 'ready',
          claim: response.claim?.communityId === this.communityId().trim()
            ? response.claim
            : null,
        })),
        catchError((error: unknown) => {
          this.latestClaim = null;
          this.reportError(
            error,
            'getMyCommunityOfficialClaim',
            'Não foi possível consultar o estado atual do selo oficial.'
          );
          return of<ClaimState>({ status: 'error', claim: null });
        }),
        startWith<ClaimState>({ status: 'loading', claim: null })
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly submissionState$: Observable<SubmissionState> =
    this.submissionRequests$.pipe(
      exhaustMap((candidate) =>
        this.repository.submitCommunityOfficialClaim$({
          requestId: this.createRequestId(),
          communityId: this.communityId().trim(),
          target: candidate.target,
          declarationAccepted: true,
        }).pipe(
          tap((result) => {
            this.notifications.showSuccess(
              result.status === 'verified'
                ? 'Selo oficial confirmado.'
                : 'A solicitação do selo oficial foi atualizada.'
            );
            this.authorizationAccepted.setValue(false);
            this.claimReload$.next();
            this.capabilityReload$.next();
          }),
          map((): SubmissionState => 'idle'),
          catchError((error: unknown) => {
            this.reportError(
              error,
              'submitCommunityOfficialClaim',
              'Não foi possível solicitar o selo oficial.'
            );
            return of<SubmissionState>('idle');
          }),
          startWith<SubmissionState>('loading')
        )
      ),
      startWith<SubmissionState>('idle'),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  constructor() {
    this.targetKey.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.latestClaim = null;
        this.authorizationAccepted.setValue(false);
      });
  }

  retry(): void {
    this.capabilityReload$.next();
    this.claimReload$.next();
  }

  submit(): void {
    if (this.latestClaim && !this.canResubmit(this.latestClaim.status)) {
      this.notifications.showWarning(
        'Este vínculo já possui um selo ou estado que impede nova solicitação.'
      );
      return;
    }

    const candidate = this.latestCapability?.candidates.find(
      (item) => this.candidateKey(item) === this.targetKey.value
    );
    if (!candidate) {
      this.notifications.showWarning(
        'Escolha a entidade que esta comunidade representa.'
      );
      return;
    }

    if (!this.authorizationAccepted.value) {
      this.notifications.showWarning(
        'Confirme que você tem autorização para representar esta entidade.'
      );
      return;
    }

    this.submissionRequests$.next(candidate);
  }

  candidateKey(candidate: CommunityOfficialClaimCapabilityCandidate): string {
    return buildCommunityOfficialClaimCapabilityCandidateKey(candidate);
  }

  targetTypeLabel(candidate: CommunityOfficialClaimCapabilityCandidate): string {
    return candidate.target.type === 'organization' ? 'Organização' : 'Local';
  }

  canResubmit(status: CommunityOfficialClaimStatus): boolean {
    return status === 'rejected' || status === 'revoked' || status === 'expired';
  }

  statusLabel(status: CommunityOfficialClaimStatus): string {
    switch (status) {
    case 'pending': return 'Verificação pendente';
    case 'under_review': return 'Verificação em andamento';
    case 'verified': return 'Comunidade Oficial verificada';
    case 'rejected': return 'Verificação não concluída';
    case 'disputed': return 'Vínculo contestado';
    case 'revoked': return 'Verificação revogada';
    case 'expired': return 'Verificação expirada';
    }
  }

  capabilityMessage(capability: CommunityOfficialClaimCapabilityResponse): string {
    switch (capability.reason) {
    case 'community_already_official':
      return 'Esta comunidade já possui um selo oficial verificado.';
    case 'verification_inactive':
      return 'Uma verificação necessária está vencida ou inativa. Regularize-a para solicitar o selo oficial.';
    case 'verification_required':
      return 'Para solicitar o selo oficial, conclua primeiro a verificação necessária da sua conta ou do vínculo que você representa.';
    case 'no_eligible_target':
      return 'No momento, não há nenhum vínculo disponível para transformar esta comunidade em oficial.';
    case 'eligible':
      return capability.candidates.length === 1
        ? 'Encontramos uma entidade elegível para esta comunidade.'
        : 'Escolha a entidade que esta comunidade representa.';
    }
  }

  private createRequestId(): string {
    try {
      const uuid = globalThis.crypto?.randomUUID?.();
      if (uuid) return uuid;
    } catch {
      // Fallback local; o backend mantém a idempotência canônica.
    }

    return `official-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 12)}`.slice(0, 64);
  }

  private reportError(
    error: unknown,
    operation: string,
    fallbackMessage: string
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation,
      fallbackMessage,
      metadata: {
        scope: 'CommunityOfficialClaimPanelComponent',
        communityId: this.communityId().trim(),
      },
    });
  }
}
