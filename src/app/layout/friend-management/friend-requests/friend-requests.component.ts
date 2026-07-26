// src/app/layout/friend-management/friend-requests/friend-requests.component.ts
// =============================================================================
// SOLICITAÇÕES DE AMIZADE
//
// Responsabilidades:
// - exibir solicitações recebidas e enviadas;
// - aceitar, recusar, cancelar e bloquear com feedback acessível;
// - consumir exclusivamente o estado NgRx de amizades;
// - manter o bootstrap realtime no LayoutShellComponent;
// - preservar uma apresentação compacta e utilizável no mobile.
// =============================================================================
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { filter, firstValueFrom, take } from 'rxjs';

import { SharedMaterialModule } from 'src/app/shared/shared-material.module';
import { DateFormatPipe } from 'src/app/shared/pipes/date-format.pipe';
import { ConfirmacaoDialogComponent } from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';
import { AppState } from 'src/app/store/states/app.state';
import * as A from 'src/app/store/actions/actions.interactions/actions.friends';
import { selectCurrentUserUid } from 'src/app/store/selectors/selectors.user/user.selectors';
import { selectRequestsLoading } from 'src/app/store/selectors/selectors.interactions/friends/inbound.selectors';
import {
  selectCancelingOutboundRequestIds,
  selectOutboundRequestsLoading,
} from 'src/app/store/selectors/selectors.interactions/friends/outbound.selectors';
import {
  selectInboundRequestsCount,
  selectInboundRequestsRichVM,
  selectOutboundRequestsCount,
  selectOutboundRequestsRichVM,
} from 'src/app/store/selectors/selectors.interactions/friends';

@Component({
  selector: 'app-friend-requests',
  standalone: true,
  imports: [CommonModule, SharedMaterialModule, DateFormatPipe],
  templateUrl: './friend-requests.component.html',
  styleUrls: ['./friend-requests.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendRequestsComponent {
  private readonly store = inject(Store) as Store<AppState>;
  private readonly dialog = inject(MatDialog);

  readonly uid$ = this.store.select(selectCurrentUserUid);

  readonly inbound$ = this.store.select(selectInboundRequestsRichVM);
  readonly outbound$ = this.store.select(selectOutboundRequestsRichVM);

  readonly inboundCount$ = this.store.select(selectInboundRequestsCount);
  readonly outboundCount$ = this.store.select(selectOutboundRequestsCount);

  readonly loadingInbound$ = this.store.select(selectRequestsLoading);
  readonly loadingOutbound$ = this.store.select(selectOutboundRequestsLoading);
  readonly cancelingOutboundRequestIds$ = this.store.select(
    selectCancelingOutboundRequestIds
  );

  trackById = (_: number, item: { id?: string } | null | undefined): string | number =>
    item?.id ?? _;

  async acceptRequest(req: { id: string; requesterUid: string }): Promise<void> {
    const uid = await firstValueFrom(this.uid$.pipe(filter(Boolean), take(1)));

    this.store.dispatch(
      A.acceptFriendRequest({
        requestId: req.id,
        requesterUid: req.requesterUid,
        targetUid: uid,
      })
    );
  }

  isCancelingRequest(
    ids: readonly string[] | null | undefined,
    requestId: string | null | undefined
  ): boolean {
    const safeRequestId = String(requestId ?? '').trim();
    return Boolean(safeRequestId && (ids ?? []).includes(safeRequestId));
  }

  declineRequest(req: { id: string }): void {
    this.store.dispatch(A.declineFriendRequest({ requestId: req.id }));
  }

  cancelRequest(req: { id: string }): void {
    const requestId = String(req?.id ?? '').trim();
    if (!requestId) return;

    this.store.dispatch(A.cancelFriendRequest({ requestId }));
  }

  async blockUser(req: {
    requesterUid?: string;
    targetUid?: string;
    nickname?: string;
  }): Promise<void> {
    const uid = await firstValueFrom(this.uid$.pipe(filter(Boolean), take(1)));
    const otherUid = String(req.requesterUid ?? req.targetUid ?? '').trim();
    if (!uid || !otherUid) return;

    const displayName = String(req.nickname ?? '').trim() || 'este usuário';
    const confirmed = await firstValueFrom(
      this.dialog
        .open(ConfirmacaoDialogComponent, {
          width: 'min(92vw, 430px)',
          maxWidth: '92vw',
          autoFocus: false,
          restoreFocus: true,
          data: {
            title: 'Bloquear usuário?',
            message: `Você deixará de receber interações de ${displayName}. O desbloqueio continuará disponível nas configurações.`,
            confirmLabel: 'Bloquear',
            cancelLabel: 'Voltar',
            tone: 'danger',
          },
        })
        .afterClosed()
        .pipe(take(1))
    );

    if (confirmed !== true) return;

    this.store.dispatch(A.blockUser({ ownerUid: uid, targetUid: otherUid }));
  }
}
