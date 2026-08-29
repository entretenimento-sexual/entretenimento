import { AsyncPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  exhaustMap,
  filter,
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
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import {
  CommunityInviteCandidate,
  CommunitySentInviteItem,
} from '../data-access/community-invite.model';
import { CommunityInviteRepository } from '../data-access/community-invite.repository';

type SentInvitesState =
  | { status: 'loading'; items: readonly CommunitySentInviteItem[] }
  | { status: 'ready'; items: readonly CommunitySentInviteItem[] }
  | { status: 'empty'; items: readonly CommunitySentInviteItem[] }
  | { status: 'error'; items: readonly CommunitySentInviteItem[] };

type CandidateState =
  | { status: 'idle'; candidate: null }
  | { status: 'loading'; candidate: null }
  | { status: 'ready'; candidate: CommunityInviteCandidate }
  | { status: 'empty'; candidate: null }
  | { status: 'error'; candidate: null };

type InviteActionCommand =
  | { action: 'send'; receiverId: string; label: string }
  | { action: 'revoke'; inviteId: string; label: string };

type InviteActionState =
  | { status: 'idle'; action: null; targetId: null }
  | { status: 'loading'; action: 'send' | 'revoke'; targetId: string }
  | { status: 'error'; action: 'send' | 'revoke'; targetId: string };

const INVITE_REASON_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  community_invites_unavailable:
    'Os convites desta Comunidade não estão disponíveis neste momento.',
  invite_management_forbidden:
    'Seu acesso atual não permite gerenciar convites desta Comunidade.',
  inviter_not_allowed:
    'Seu acesso atual não permite enviar ou revogar este convite.',
  target_already_member:
    'Este perfil já participa da Comunidade.',
  target_blocked:
    'Este perfil não pode receber convites desta Comunidade.',
  community_unavailable:
    'Esta Comunidade não aceita novos convites neste momento.',
  community_capacity_reached:
    'A Comunidade atingiu a capacidade atual. Novos convites estão pausados.',
  self_invite_forbidden:
    'Você não pode enviar um convite para si mesmo.',
  invite_not_found:
    'Este convite não está mais disponível.',
  invite_not_pending:
    'Este convite não está mais pendente.',
  invite_contract_invalid:
    'Este convite não pôde ser validado com segurança.',
  invalid_invite_candidate_query:
    'Revise o apelido informado e tente novamente.',
  invalid_community_id:
    'Não foi possível identificar esta Comunidade.',
  community_not_found:
    'Esta Comunidade não está mais disponível.',
  account_restricted:
    'Esta conta não pode participar de Comunidades neste momento.',
  adult_access_required:
    'Esta conta precisa confirmar o acesso adulto antes de participar.',
  profile_incomplete:
    'Esta conta precisa concluir o perfil antes de participar.',
});

@Component({
  selector: 'app-community-invite-management',
  standalone: true,
  imports: [
    AsyncPipe,
    DatePipe,
    ReactiveFormsModule,
    ImageFallbackDirective,
  ],
  templateUrl: './community-invite-management.component.html',
  styleUrl: './community-invite-management.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityInviteManagementComponent {
  private readonly repository = inject(CommunityInviteRepository);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly reloadRequests$ = new Subject<void>();
  private readonly searchRequests$ = new Subject<string>();
  private readonly actionRequests$ = new Subject<InviteActionCommand>();

  readonly communityId = input('');
  readonly invitesChanged = output<void>();
  readonly nickname = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      Validators.minLength(3),
      Validators.maxLength(40),
    ],
  });

  private readonly communityId$ = toObservable(this.communityId).pipe(
    map((communityId) => communityId.trim()),
    filter((communityId) => communityId.length > 0),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly sentInvitesState$: Observable<SentInvitesState> = combineLatest([
    this.communityId$,
    this.reloadRequests$.pipe(startWith(undefined)),
  ]).pipe(
    switchMap(([communityId]) =>
      this.repository.getSentInvites$(communityId).pipe(
        map((response): SentInvitesState => ({
          status: response.items.length > 0 ? 'ready' : 'empty',
          items: response.items,
        })),
        startWith<SentInvitesState>({ status: 'loading', items: [] }),
        catchError((error: unknown) => {
          this.reportLoadError(error);
          return of<SentInvitesState>({ status: 'error', items: [] });
        })
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly candidateState$: Observable<CandidateState> =
    this.searchRequests$.pipe(
      exhaustMap((nickname) =>
        this.repository.findCandidate$(this.communityId(), nickname).pipe(
          map((response): CandidateState => response.candidate
            ? { status: 'ready', candidate: response.candidate }
            : { status: 'empty', candidate: null }
          ),
          startWith<CandidateState>({ status: 'loading', candidate: null }),
          catchError((error: unknown) => {
            this.reportCandidateError(error);
            return of<CandidateState>({ status: 'error', candidate: null });
          })
        )
      ),
      startWith<CandidateState>({ status: 'idle', candidate: null }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly actionState$: Observable<InviteActionState> =
    this.actionRequests$.pipe(
      exhaustMap((command) => {
        const targetId = command.action === 'send'
          ? command.receiverId
          : command.inviteId;
        const operation$ = command.action === 'send'
          ? this.repository.sendInvite$(this.communityId(), command.receiverId)
          : this.repository.revokeInvite$(command.inviteId);

        return operation$.pipe(
          tap((result) => {
            this.notifications.showSuccess(
              command.action === 'send'
                ? result.deduplicated
                  ? `O convite para ${command.label} já está pendente.`
                  : `Convite enviado para ${command.label}.`
                : `Convite para ${command.label} revogado.`
            );
            this.reloadRequests$.next();
            const currentNickname = this.nickname.value.trim();
            if (currentNickname) this.searchRequests$.next(currentNickname);
            this.invitesChanged.emit();
          }),
          map((): InviteActionState => ({
            status: 'idle',
            action: null,
            targetId: null,
          })),
          startWith<InviteActionState>({
            status: 'loading',
            action: command.action,
            targetId,
          }),
          catchError((error: unknown) => {
            this.reportActionError(error, command.action);
            return of<InviteActionState>({
              status: 'error',
              action: command.action,
              targetId,
            });
          })
        );
      }),
      startWith<InviteActionState>({
        status: 'idle',
        action: null,
        targetId: null,
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  search(): void {
    if (this.nickname.invalid) {
      this.nickname.markAsTouched();
      this.notifications.showWarning(
        'Informe o apelido exato com pelo menos 3 caracteres.'
      );
      return;
    }

    this.searchRequests$.next(this.nickname.value.trim());
  }

  send(candidate: CommunityInviteCandidate): void {
    if (candidate.status !== 'eligible') return;
    this.actionRequests$.next({
      action: 'send',
      receiverId: candidate.userId,
      label: candidate.nickname,
    });
  }

  revoke(invite: CommunitySentInviteItem): void {
    this.actionRequests$.next({
      action: 'revoke',
      inviteId: invite.inviteId,
      label: invite.receiverLabel,
    });
  }

  retrySentInvites(): void {
    this.reloadRequests$.next();
  }

  candidateStatusLabel(candidate: CommunityInviteCandidate): string {
    if (candidate.status === 'already_member') {
      return 'Este perfil já participa da Comunidade.';
    }
    if (candidate.status === 'invite_pending') {
      return 'Já existe um convite pendente para este perfil.';
    }
    if (candidate.status === 'access_unavailable') {
      return 'Este perfil não pode receber o convite no momento.';
    }
    return 'Perfil disponível para convite.';
  }

  private reportLoadError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'loadSentInvites',
      fallbackMessage: 'Não foi possível carregar os convites pendentes.',
      notification: 'none',
      reasonMessages: INVITE_REASON_MESSAGES,
      metadata: {
        scope: 'CommunityInviteManagementComponent',
        communityId: this.communityId().trim(),
      },
    });
  }

  private reportCandidateError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'findInviteCandidate',
      fallbackMessage: 'Não foi possível localizar este perfil.',
      notification: 'none',
      reasonMessages: INVITE_REASON_MESSAGES,
      metadata: {
        scope: 'CommunityInviteManagementComponent',
        communityId: this.communityId().trim(),
      },
    });
  }

  private reportActionError(
    error: unknown,
    action: 'send' | 'revoke'
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: action === 'send' ? 'sendInvite' : 'revokeInvite',
      fallbackMessage: action === 'send'
        ? 'Não foi possível enviar este convite.'
        : 'Não foi possível revogar este convite.',
      reasonMessages: INVITE_REASON_MESSAGES,
      codeMessages: {
        'already-exists': 'Este perfil já participa da Comunidade.',
        'not-found': 'Este convite ou Comunidade não está mais disponível.',
        'permission-denied':
          'Seu acesso atual não permite executar esta ação de convite.',
        'failed-precondition':
          'Este convite não pode ser alterado nas condições atuais.',
        'invalid-argument':
          'Não foi possível validar os dados deste convite.',
      },
      metadata: {
        scope: 'CommunityInviteManagementComponent',
        communityId: this.communityId().trim(),
        action,
      },
    });
  }
}
