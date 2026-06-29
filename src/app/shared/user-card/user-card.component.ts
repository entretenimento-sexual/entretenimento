// src/app/shared/user-card/user-card.component.ts
import { CommonModule } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { Router, RouterModule } from '@angular/router';

import { Store } from '@ngrx/store';
import { take } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

import { AppState } from 'src/app/store/states/app.state';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';
import * as FriendActions from 'src/app/store/actions/actions.interactions/actions.friends';
import {
  ConfirmationDialogComponent,
  ConfirmationDialogData,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';

import {
  selectAllFriends,
  selectBlockedFriends,
  selectInboundRequests,
  selectOutboundRequests,
  selectEndingFriendshipUid,
} from 'src/app/store/selectors/selectors.interactions/friends';
import { selectCancelingOutboundRequestIds } from 'src/app/store/selectors/selectors.interactions/friends/outbound.selectors';
import {
  ModalMensagemComponent,
  ModalMensagemResult,
} from 'src/app/shared/components-globais/modal-mensagem/modal-mensagem.component';

import { SendRequestDialogComponent } from 'src/app/shared/components-globais/user-card/send-request-dialog/send-request-dialog.component';

type UserRelationshipState =
  | 'self'
  | 'none'
  | 'friends'
  | 'outgoing_pending'
  | 'incoming_pending'
  | 'blocked_by_me';

interface UserCardRelationshipVm {
  state: UserRelationshipState;
  currentUid: string | null;
  targetUid: string | null;

  /**
   * Interesse recebido pendente.
   * Usado para responder em /friends/requests.
   */
  inboundRequestId: string | null;

  /**
   * Interesse enviado pendente.
   * Usado para cancelar diretamente pelo card.
   */
  outboundRequestId: string | null;

  canMessage: boolean;
  canConnect: boolean;
  canRespond: boolean;
  canCancelRequest: boolean;
  isPending: boolean;
  isBlocked: boolean;
  label: string;
}

@Component({
  selector: 'app-user-card',
  templateUrl: './user-card.component.html',
  styleUrls: ['./user-card.component.css'],
  standalone: true,
  imports: [CommonModule, RouterModule],
})
export class UserCardComponent {
  readonly user = input.required<IUserDados | null>();
  readonly distanciaKm = input<number | null>(null);
  readonly showDistance = input<boolean>(true);

  private readonly dialog = inject(MatDialog);
  private readonly store = inject(Store) as Store<AppState>;
  private readonly notifier = inject(ErrorNotificationService);
  private readonly router = inject(Router);

  private readonly currentUser = toSignal(
    this.store.select(selectCurrentUser),
    { initialValue: null }
  );

  private readonly friends = toSignal(
    this.store.select(selectAllFriends),
    { initialValue: [] }
  );

  private readonly inboundRequests = toSignal(
    this.store.select(selectInboundRequests),
    { initialValue: [] }
  );

  private readonly outboundRequests = toSignal(
    this.store.select(selectOutboundRequests),
    { initialValue: [] }
  );

  private readonly blockedUsers = toSignal(
    this.store.select(selectBlockedFriends),
    { initialValue: [] }
  );

  private readonly endingFriendshipUid = toSignal(
    this.store.select(selectEndingFriendshipUid),
    { initialValue: null }
  );

  private readonly cancelingOutboundRequestIds = toSignal(
    this.store.select(selectCancelingOutboundRequestIds),
    { initialValue: [] }
  );

  readonly nicknameClass = computed(() =>
    this.getUserNicknameClass(this.user())
  );

  readonly relationshipVm = computed<UserCardRelationshipVm>(() => {
    const profile = this.user();
    const currentUser = this.currentUser();

    const currentUid = String(currentUser?.uid ?? '').trim() || null;
    const targetUid = String(profile?.uid ?? '').trim() || null;

    if (!currentUid || !targetUid) {
      return this.buildRelationshipVm('none', currentUid, targetUid);
    }

    if (currentUid === targetUid) {
      return this.buildRelationshipVm('self', currentUid, targetUid);
    }

    const isBlockedByMe = (this.blockedUsers() ?? []).some((item: any) => {
      const blockedUid = String(
        item?.uid ??
        item?.targetUid ??
        item?.friendUid ??
        ''
      ).trim();

      return blockedUid === targetUid && item?.isBlocked !== false;
    });

    if (isBlockedByMe) {
      return this.buildRelationshipVm('blocked_by_me', currentUid, targetUid);
    }

    const isFriend = (this.friends() ?? []).some((friend) => {
      return String(friend?.friendUid ?? '').trim() === targetUid;
    });

    if (isFriend) {
      return this.buildRelationshipVm('friends', currentUid, targetUid);
    }

    const inboundRequest = (this.inboundRequests() ?? []).find((request) => {
      return (
        request.status === 'pending' &&
        String(request.requesterUid ?? '').trim() === targetUid &&
        String(request.targetUid ?? '').trim() === currentUid
      );
    });

    if (inboundRequest) {
      return this.buildRelationshipVm(
        'incoming_pending',
        currentUid,
        targetUid,
        String(inboundRequest.id ?? '').trim() || null
      );
    }

    const outboundRequest = (this.outboundRequests() ?? []).find((request) => {
      return (
        request.status === 'pending' &&
        String(request.requesterUid ?? '').trim() === currentUid &&
        String(request.targetUid ?? '').trim() === targetUid
      );
    });

    if (outboundRequest) {
      return this.buildRelationshipVm(
        'outgoing_pending',
        currentUid,
        targetUid,
        null,
        String(outboundRequest.id ?? '').trim() || null
      );
    }

    return this.buildRelationshipVm('none', currentUid, targetUid);
  });

  readonly isEndingFriendship = computed(() => {
  const targetUid = String(this.relationshipVm().targetUid ?? '').trim();
  const endingUid = String(this.endingFriendshipUid() ?? '').trim();

  return !!targetUid && !!endingUid && targetUid === endingUid;
});

readonly isCancelingOutgoingRequest = computed(() => {
  const requestId = String(this.relationshipVm().outboundRequestId ?? '').trim();

  if (!requestId) {
    return false;
  }

  return (this.cancelingOutboundRequestIds() ?? []).includes(requestId);
});

  abrirDM(event: Event): void {
    event.preventDefault();

    const profile = this.user();
    const targetUid = String(profile?.uid ?? '').trim();

    if (!profile || !targetUid) {
      this.notifier.showInfo('Perfil indisponível para conversa.');
      return;
    }

    const relationship = this.relationshipVm();

    if (!relationship.canMessage) {
      if (relationship.state === 'incoming_pending') {
        this.notifier.showInfo('Responda ao interesse antes de conversar.');
        this.router.navigate(['/friends/requests']).catch(() => undefined);
        return;
      }

      if (relationship.state === 'outgoing_pending') {
        this.notifier.showInfo('Aguarde este perfil responder ao seu interesse.');
        return;
      }

      if (relationship.state === 'none') {
        this.notifier.showInfo('Mostre interesse antes de iniciar conversa.');
        return;
      }

      this.notifier.showInfo('Conversa indisponível para este perfil.');
      return;
    }

    const ref = this.dialog.open<
      ModalMensagemComponent,
      { profile: IUserDados },
      ModalMensagemResult | true | undefined
    >(ModalMensagemComponent, {
      panelClass: 'direct-message-dialog-panel',
      width: 'min(92vw, 420px)',
      maxWidth: '92vw',
      restoreFocus: true,
      data: { profile },
    });

    ref.afterClosed()
      .pipe(take(1))
      .subscribe((result) => {
        if (!result || result === true) {
          return;
        }

        this.router.navigate(['/chat'], {
          queryParams: {
            openChatId: result.chatId,
            withUser: result.targetUid,
          },
        }).catch(() => {
          this.notifier.showWarning(
            'Mensagem enviada, mas não foi possível abrir a conversa automaticamente.'
          );
        });
      });
  }

desfazerAmizade(event: Event): void {
  event.preventDefault();
  event.stopPropagation();

  const profile = this.user();
  const relationship = this.relationshipVm();

  const currentUid = String(relationship.currentUid ?? '').trim();
  const targetUid = String(relationship.targetUid ?? '').trim();

  if (!profile || !currentUid || !targetUid) {
    this.notifier.showInfo('Não foi possível identificar esta conexão.');
    return;
  }

  if (relationship.state !== 'friends') {
    this.notifier.showInfo('Vocês não estão conectados.');
    return;
  }

  if (this.isEndingFriendship()) {
  this.notifier.showInfo('Aguarde. Estamos desfazendo esta conexão.');
  return;
}

  const nickname = profile.nickname || 'este perfil';

  const dialogData: ConfirmationDialogData = {
    eyebrow: 'Conexão',
    title: 'Desfazer conexão?',
    message: `Você deixará de estar conectado com ${nickname}.`,
    detail:
  'Novas mensagens ficarão bloqueadas até que uma nova conexão seja aceita. O histórico existente será mantido por segurança e não será apagado automaticamente.',
    confirmLabel: 'Desfazer conexão',
    cancelLabel: 'Manter conexão',
    icon: 'person_remove',
    tone: 'danger',
  };

  const ref = this.dialog.open<
    ConfirmationDialogComponent,
    ConfirmationDialogData,
    boolean
  >(ConfirmationDialogComponent, {
    panelClass: 'confirmation-dialog-panel',
    width: 'min(94vw, 460px)',
    maxWidth: '94vw',
    autoFocus: false,
    restoreFocus: true,
    data: dialogData,
  });

  ref.afterClosed()
    .pipe(take(1))
    .subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }

      this.store.dispatch(
        FriendActions.endFriendship({
          ownerUid: currentUid,
          friendUid: targetUid,
        })
      );
    });
}

cancelarSolicitacaoEnviada(event: Event): void {
  event.preventDefault();
  event.stopPropagation();

  const relationship = this.relationshipVm();
  const requestId = String(relationship.outboundRequestId ?? '').trim();

  if (relationship.state !== 'outgoing_pending') {
    this.notifier.showInfo('Não há interesse enviado pendente para este perfil.');
    return;
  }

  if (!requestId) {
    this.notifier.showInfo('Não foi possível identificar o interesse enviado.');
    this.router.navigate(['/friends/requests']).catch(() => undefined);
    return;
  }

  if (this.isCancelingOutgoingRequest()) {
    this.notifier.showInfo('Aguarde. Estamos cancelando este interesse.');
    return;
  }

  this.store.dispatch(
    FriendActions.cancelFriendRequest({
      requestId,
    })
  );
}

  adicionarAmigo(): void {
    const target = this.user();

    if (!target) {
      return;
    }

    const relationship = this.relationshipVm();

    if (relationship.state === 'self') {
      this.notifier.showInfo('Você não pode mostrar interesse no próprio perfil.');
      return;
    }

    if (relationship.state === 'friends') {
      this.notifier.showInfo('Vocês já estão conectados.');
      return;
    }

    if (relationship.state === 'incoming_pending') {
      this.router.navigate(['/friends/requests']).catch(() => undefined);
      return;
    }

    if (relationship.state === 'outgoing_pending') {
      this.notifier.showInfo('Interesse já enviado. Aguarde a resposta.');
      return;
    }

    if (relationship.state === 'blocked_by_me') {
      this.notifier.showInfo('Desbloqueie este perfil antes de mostrar interesse.');
      return;
    }

    if (!relationship.currentUid || !relationship.targetUid) {
      this.notifier.showInfo('É necessário estar logado.');
      return;
    }

    const ref = this.dialog.open(SendRequestDialogComponent, {
      panelClass: 'send-request-dialog-panel',
      width: 'min(92vw, 460px)',
      maxWidth: '96vw',
      autoFocus: false,
      restoreFocus: true,
      data: {
        requesterUid: relationship.currentUid,
        targetUid: relationship.targetUid,
        nickname: target.nickname,
        avatarUrl: target.photoURL,
        uid: target.uid,
        maxLength: 200,
      },
    });

    ref.afterClosed()
      .pipe(take(1))
      .subscribe((res) => {
        if (!res) {
          return;
        }

        if (res.ok) {
          this.notifier.showSuccess('Interesse enviado com sucesso.');
          return;
        }

        if (res.error) {
          this.notifier.showError(res.error);
        }
      });
  }

  getUserNicknameClass(user: IUserDados | null): string {
    if (!user) {
      return '';
    }

    if (user.isOnline) {
      return 'nickname-online';
    }

    if (!user.lastLogin) {
      return '';
    }

    const toDate = (value: unknown): Date => {
      if (value instanceof Date) {
        return value;
      }

      if (typeof value === 'number') {
        return new Date(value);
      }

      const maybeTimestamp = value as { toDate?: () => Date } | null | undefined;

      if (typeof maybeTimestamp?.toDate === 'function') {
        return maybeTimestamp.toDate();
      }

      return new Date(String(value));
    };

    const now = Date.now();
    const last = toDate(user.lastLogin).getTime();

    if (!Number.isFinite(last)) {
      return '';
    }

    const days = Math.floor((now - last) / (1000 * 60 * 60 * 24));

    if (days <= 7) {
      return 'nickname-recent';
    }

    if (days > 30) {
      return 'nickname-inactive';
    }

    return 'nickname-offline';
  }

private buildRelationshipVm(
  state: UserRelationshipState,
  currentUid: string | null,
  targetUid: string | null,
  inboundRequestId: string | null = null,
  outboundRequestId: string | null = null
): UserCardRelationshipVm {
    switch (state) {
      case 'self':
        return {
          state,
          currentUid,
          targetUid,
          inboundRequestId,
          outboundRequestId,
          canMessage: false,
          canConnect: false,
          canRespond: false,
          isPending: false,
          isBlocked: false,
          canCancelRequest: false,
          label: 'Meu perfil',
        };

      case 'friends':
        return {
          state,
          currentUid,
          targetUid,
          inboundRequestId,
          outboundRequestId,
          canMessage: true,
          canConnect: false,
          canRespond: false,
          isPending: false,
          isBlocked: false,
          canCancelRequest: false,
          label: 'Conversar',
        };

      case 'incoming_pending':
        return {
          state,
          currentUid,
          targetUid,
          inboundRequestId,
          outboundRequestId,
          canMessage: false,
          canConnect: false,
          canRespond: true,
          isPending: true,
          isBlocked: false,
          canCancelRequest: false,
          label: 'Responder',
        };

case 'outgoing_pending':
  return {
    state,
    currentUid,
    targetUid,
    inboundRequestId,
    outboundRequestId,
    canMessage: false,
    canConnect: false,
    canRespond: false,
    canCancelRequest: true,
    isPending: true,
    isBlocked: false,
    label: 'Aguardando resposta',
  };

      case 'blocked_by_me':
        return {
          state,
          currentUid,
          targetUid,
          inboundRequestId,
          outboundRequestId,
          canMessage: false,
          canConnect: false,
          canRespond: false,
          isPending: false,
          isBlocked: true,
          canCancelRequest: false,
          label: 'Bloqueado',
        };

      case 'none':
      default:
        return {
          state,
          currentUid,
          targetUid,
          inboundRequestId,
          outboundRequestId,
          canMessage: false,
          canConnect: true,
          canRespond: false,
          isPending: false,
          isBlocked: false,
          canCancelRequest: false,
          label: 'Interesse',
        };
    }
  }
}
