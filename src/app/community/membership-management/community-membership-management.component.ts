// src/app/community/membership-management/community-membership-management.component.ts
import { AsyncPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
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
  CommunityMembershipRequestItem,
  CommunityMembershipReviewAction,
} from '../data-access/community-membership.model';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import type { CommunityCapacityPreview } from '../data-access/community-capacity.model';
import {
  CommunityPreviewSourceType,
  CommunityPreviewViewerRole,
} from '../data-access/community-preview.model';
import { CommunityMemberRosterManagementComponent } from '../member-roster-management/community-member-roster-management.component';
import { CommunityOwnershipManagementComponent } from '../ownership-management/community-ownership-management.component';
import { CommunitySettingsComponent } from '../community-settings/community-settings.component';
import type { CommunityEditableSettings } from '../data-access/community-settings.model';

type MembershipRequestsState =
  | { status: 'loading'; items: readonly CommunityMembershipRequestItem[] }
  | { status: 'ready'; items: readonly CommunityMembershipRequestItem[] }
  | { status: 'error'; items: readonly CommunityMembershipRequestItem[] };

type MembershipReviewActionState =
  | { status: 'idle'; memberId: null; action: null }
  | {
      status: 'loading' | 'error';
      memberId: string;
      action: CommunityMembershipReviewAction;
    };

interface MembershipReviewCommand {
  request: CommunityMembershipRequestItem;
  action: CommunityMembershipReviewAction;
}

const MEMBERSHIP_REVIEW_REASON_MESSAGES: Readonly<Record<string, string>> =
  Object.freeze({
    community_capacity_reached:
      'A capacidade atual foi atingida. A solicitação continua pendente.',
    moderator_required:
      'Seu acesso de moderação não permite revisar esta solicitação.',
    self_review_forbidden:
      'Você não pode revisar a própria solicitação.',
    membership_blocked:
      'Este vínculo está bloqueado e não pode ser alterado.',
    protected_membership:
      'Este participante possui uma função protegida nesta Comunidade.',
    membership_request_not_pending:
      'Esta solicitação já foi processada ou não está mais pendente.',
    account_restricted:
      'A conta deste participante não está elegível para entrada neste momento.',
    adult_access_required:
      'A conta deste participante precisa confirmar o acesso adulto antes da entrada.',
    profile_incomplete:
      'A conta deste participante precisa concluir o perfil antes da entrada.',
  });

@Component({
  selector: 'app-community-membership-management',
  standalone: true,
  imports: [
    AsyncPipe,
    DatePipe,
    CommunityMemberRosterManagementComponent,
    CommunityOwnershipManagementComponent,
    CommunitySettingsComponent,
  ],
  templateUrl: './community-membership-management.component.html',
  styleUrl: './community-membership-management.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityMembershipManagementComponent {
  private readonly repository = inject(CommunityMembershipRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly refreshRequests$ = new Subject<void>();
  private readonly reviewRequests$ = new Subject<MembershipReviewCommand>();

  readonly communityId = input.required<string>();
  readonly sourceType = input<CommunityPreviewSourceType>('community');
  readonly viewerRole = input<CommunityPreviewViewerRole | null>(null);
  readonly canManageCommunitySettings = input(false);
  readonly settings = input<CommunityEditableSettings | null>(null);
  readonly capacity = input<CommunityCapacityPreview | null>(null);
  readonly membershipChanged = output<void>();
  readonly ownershipChanged = output<void>();
  readonly settingsChanged = output<void>();

  private readonly communityId$ = toObservable(this.communityId).pipe(
    map((communityId) => communityId.trim()),
    filter((communityId) => communityId.length > 0),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly state$ = combineLatest([
    this.communityId$,
    this.refreshRequests$.pipe(startWith(undefined)),
  ]).pipe(
    switchMap(([communityId]) =>
      this.repository.getMembershipRequests$(communityId).pipe(
        map(
          (response): MembershipRequestsState => ({
            status: 'ready',
            items: response.items,
          })
        ),
        startWith<MembershipRequestsState>({ status: 'loading', items: [] }),
        catchError((error: unknown) => {
          this.reportLoadError(error);
          return of<MembershipRequestsState>({ status: 'error', items: [] });
        })
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly action$ = this.reviewRequests$.pipe(
    exhaustMap(({ request, action }) =>
      this.repository
        .reviewMembership$(
          this.communityId().trim(),
          request.memberId,
          action
        )
        .pipe(
          tap(() => {
            this.errorNotifier.showSuccess(
              action === 'approve'
                ? this.approvalSuccessMessage(request.label)
                : `Solicitação de ${request.label} recusada.`
            );
            this.membershipChanged.emit();
            this.refreshRequests$.next();
          }),
          map(
            (): MembershipReviewActionState => ({
              status: 'idle',
              memberId: null,
              action: null,
            })
          ),
          startWith<MembershipReviewActionState>({
            status: 'loading',
            memberId: request.memberId,
            action,
          }),
          catchError((error: unknown) => {
            this.reportReviewError(error, action);
            return of<MembershipReviewActionState>({
              status: 'error',
              memberId: request.memberId,
              action,
            });
          })
        )
    ),
    startWith<MembershipReviewActionState>({
      status: 'idle',
      memberId: null,
      action: null,
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  managementTitle(): string {
    return this.sourceType() === 'venue'
      ? 'Solicitações de acesso'
      : 'Solicitações de entrada';
  }

  emptyMessage(): string {
    return this.sourceType() === 'venue'
      ? 'Nenhuma solicitação de acesso pendente.'
      : 'Nenhuma solicitação de entrada pendente.';
  }

  refresh(): void {
    this.refreshRequests$.next();
  }

  review(
    request: CommunityMembershipRequestItem,
    action: CommunityMembershipReviewAction
  ): void {
    this.reviewRequests$.next({ request, action });
  }

  private approvalSuccessMessage(label: string): string {
    return this.sourceType() === 'venue'
      ? `${label} recebeu acesso ao Local.`
      : `${label} entrou na Comunidade.`;
  }

  private reportLoadError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'loadMembershipRequests',
      fallbackMessage: this.sourceType() === 'venue'
        ? 'Não foi possível carregar as solicitações de acesso.'
        : 'Não foi possível carregar as solicitações de entrada.',
      // A própria fila já possui estado inline de indisponibilidade.
      notification: 'none',
      metadata: {
        scope: 'CommunityMembershipManagementComponent',
        communityId: this.communityId(),
        sourceType: this.sourceType(),
      },
    });
  }

  private reportReviewError(
    error: unknown,
    action: CommunityMembershipReviewAction
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'reviewMembership',
      fallbackMessage: this.sourceType() === 'venue'
        ? 'Não foi possível revisar esta solicitação de acesso.'
        : 'Não foi possível revisar esta solicitação de entrada.',
      reasonMessages: MEMBERSHIP_REVIEW_REASON_MESSAGES,
      codeMessages: {
        'permission-denied':
          'Seu acesso atual não permite revisar esta solicitação.',
        'failed-precondition':
          'Esta solicitação não pode ser alterada no estado atual.',
        'not-found':
          'Esta solicitação ou Comunidade não está mais disponível.',
        'invalid-argument':
          'Não foi possível validar esta solicitação.',
      },
      metadata: {
        scope: 'CommunityMembershipManagementComponent',
        communityId: this.communityId(),
        sourceType: this.sourceType(),
        action,
      },
    });
  }
}
