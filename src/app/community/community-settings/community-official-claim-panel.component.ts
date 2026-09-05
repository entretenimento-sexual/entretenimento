import { AsyncPipe, DatePipe } from '@angular/common';
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
import type {
  CommunityOfficialClaimCapabilityCandidate,
  CommunityOfficialClaimCapabilityResponse,
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
  imports: [AsyncPipe, DatePipe, ReactiveFormsModule],
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
  readonly targetId = new FormControl('', { nonNullable: true });
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
            const currentTargetId = this.targetId.value;
            const currentStillAvailable = capability.candidates.some(
              (candidate) => candidate.target.id === currentTargetId
            );
            const nextTargetId = currentStillAvailable
              ? currentTargetId
              : capability.candidates[0]?.target.id ?? '';

            if (nextTargetId !== currentTargetId) {
              this.targetId.setValue(nextTargetId);
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
    this.targetId.valueChanges.pipe(startWith(this.targetId.value)),
    this.claimReload$.pipe(startWith(undefined)),
  ]).pipe(
    switchMap(([capabilityState, targetId]) => {
      if (capabilityState.status !== 'ready' || !targetId) {
        this.latestClaim = null;
        return of<ClaimState>({ status: 'idle', claim: null });
      }

      const candidate = capabilityState.capability.candidates.find(
        (item) => item.target.id === targetId
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
    this.targetId.valueChanges
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
      (item) => item.target.id === this.targetId.value
    );
    if (!candidate) {
      this.notifications.showWarning(
        'Selecione um Local elegível para a Comunidade Oficial.'
      );
      return;
    }

    this.submissionRequests$.next(candidate);
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
      return 'Sua verificação comercial está inativa. Regularize-a para solicitar um vínculo oficial.';
    case 'verification_required':
      return 'É necessária uma verificação comercial ativa antes de reivindicar um Local.';
    case 'no_eligible_target':
      return 'Nenhum Local ativo sob sua responsabilidade está disponível para esta reivindicação.';
    case 'eligible':
      return 'Selecione o Local cuja autoridade será confirmada novamente pelo servidor.';
    }
  }

  authorityLabel(candidate: CommunityOfficialClaimCapabilityCandidate): string {
    return candidate.authorityRole === 'owner' ? 'Proprietário' : 'Gestor autorizado';
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
