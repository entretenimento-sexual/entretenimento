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
  readonly declarationAccepted = new FormControl(false, { nonNullable: true });

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
            const nextTargetKey = currentStillAvailable
              ? currentTargetKey
              : capability.candidates[0]
                ? this.candidateKey(capability.candidates[0])
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
              'Não foi possível consultar a elegibilidade para Comunidade Oficial.'
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
    this.targetKey.valueChanges.pipe(startWith(this.targetKey.value)),
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
            'Não foi possível consultar o andamento da verificação oficial.'
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
            this.declarationAccepted.setValue(false);
            this.notifications.showSuccess(
              result.submitted
                ? 'Solicitação de Comunidade Oficial enviada para análise.'
                : 'O andamento da solicitação foi atualizado.'
            );
            this.claimReload$.next();
            this.capabilityReload$.next();
          }),
          map((): SubmissionState => 'idle'),
          catchError((error: unknown) => {
            this.reportError(
              error,
              'submitCommunityOfficialClaim',
              'Não foi possível enviar a solicitação de Comunidade Oficial.'
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
        this.declarationAccepted.setValue(false, { emitEvent: false });
      });
  }

  retry(): void {
    this.capabilityReload$.next();
    this.claimReload$.next();
  }

  submit(): void {
    if (!this.declarationAccepted.value) {
      this.notifications.showWarning(
        'Confirme a declaração de responsabilidade antes de enviar.'
      );
      return;
    }

    if (this.latestClaim && !this.canResubmit(this.latestClaim.status)) {
      this.notifications.showWarning(
        'Esta solicitação já possui um andamento que impede novo envio.'
      );
      return;
    }

    const candidate = this.latestCapability?.candidates.find(
      (item) => this.candidateKey(item) === this.targetKey.value
    );
    if (!candidate) {
      this.notifications.showWarning(
        'Selecione um Local ou uma Organização elegível para a Comunidade Oficial.'
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
    case 'pending': return 'Aguardando análise';
    case 'under_review': return 'Em análise';
    case 'verified': return 'Comunidade Oficial verificada';
    case 'rejected': return 'Solicitação rejeitada';
    case 'disputed': return 'Vínculo contestado';
    case 'revoked': return 'Verificação revogada';
    case 'expired': return 'Verificação expirada';
    }
  }

  capabilityMessage(capability: CommunityOfficialClaimCapabilityResponse): string {
    switch (capability.reason) {
    case 'community_already_official':
      return 'Esta Comunidade já possui um vínculo oficial verificado.';
    case 'verification_inactive':
      return 'A verificação necessária para um dos seus vínculos está inativa ou vencida. Regularize-a antes de solicitar o vínculo oficial.';
    case 'verification_required':
      return 'É necessária uma verificação válida para reivindicar um Local ou uma Organização. Locais usam a verificação comercial; Organizações exigem KYB e representação ativa.';
    case 'no_eligible_target':
      return 'Nenhum Local ou Organização ativo sob sua autoridade está disponível para esta reivindicação.';
    case 'eligible':
      return 'Selecione o Local ou a Organização. Sua autoridade será confirmada novamente pelo servidor antes do envio.';
    }
  }

  authorityLabel(candidate: CommunityOfficialClaimCapabilityCandidate): string {
    switch (candidate.authorityRole) {
    case 'owner': return 'Proprietário';
    case 'authorized_representative': return 'Representante autorizado';
    case 'manager': return 'Gestor autorizado';
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
