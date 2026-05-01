// src/app/layout/friend-management/friend-requests/friend-requests.component.ts
// ✅ COMPONENTE DE SOLICITAÇÕES DE AMIZADE (INBOUND + OUTBOUND)
// - ✅ mostra solicitações recebidas e enviadas
// - ✅ ações: aceitar/recusar (inbound) e cancelar (outbound)
// - ✅ bloqueio direto do usuário (sem precisar aceitar/recusar antes)
// - ✅ consome dados do store
// - ✅ o owner global do realtime/bootstrap agora fica no LayoutShellComponent
// - ✅ trackBy para listas
// - ✅ confirmações para ações destrutivas (ex: bloquear usuário).
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { map, filter, take, combineLatest, firstValueFrom } from 'rxjs';
import { AppState } from 'src/app/store/states/app.state';
import { SharedMaterialModule } from 'src/app/shared/shared-material.module';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DateFormatPipe } from 'src/app/shared/pipes/date-format.pipe';

import { selectCurrentUserUid } from 'src/app/store/selectors/selectors.user/user.selectors';
import { selectRequestsLoading } from 'src/app/store/selectors/selectors.interactions/friends/inbound.selectors';
import { selectOutboundRequestsLoading } from 'src/app/store/selectors/selectors.interactions/friends/outbound.selectors';
import * as A from 'src/app/store/actions/actions.interactions/actions.friends';

import {
  selectInboundRequestsRichVM,
  selectOutboundRequestsRichVM,
  selectInboundRequestsCount,
  selectOutboundRequestsCount,
} from 'src/app/store/selectors/selectors.interactions/friends';

@Component({
  selector: 'app-friend-requests',
  standalone: true,
  imports: [CommonModule, SharedMaterialModule, DateFormatPipe, MatTooltipModule],
  templateUrl: './friend-requests.component.html',
  styleUrls: ['./friend-requests.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendRequestsComponent {
  private store = inject(Store) as Store<AppState>;

  uid$ = this.store.select(selectCurrentUserUid);

  inbound$ = this.store.select(selectInboundRequestsRichVM);
  outbound$ = this.store.select(selectOutboundRequestsRichVM);

  inboundCount$ = this.store.select(selectInboundRequestsCount);
  outboundCount$ = this.store.select(selectOutboundRequestsCount);

  loadingInbound$ = this.store.select(selectRequestsLoading);
  loadingOutbound$ = this.store.select(selectOutboundRequestsLoading);

  bothLoading$ = combineLatest([this.loadingInbound$, this.loadingOutbound$]).pipe(
    map(([a, b]) => !!a || !!b)
  );

  trackById = (_: number, item: any) => item?.id ?? _;

  async acceptRequest(req: { id: string; requesterUid: string }) {
    const uid = await firstValueFrom(this.uid$.pipe(filter(Boolean), take(1)));
    this.store.dispatch(
      A.acceptFriendRequest({
        requestId: req.id,
        requesterUid: req.requesterUid,
        targetUid: uid!,
      })
    );
  }

  declineRequest(req: { id: string }) {
    this.store.dispatch(A.declineFriendRequest({ requestId: req.id }));
  }

  cancelRequest(req: { id: string }) {
    this.store.dispatch(A.cancelFriendRequest({ requestId: req.id }));
  }

  async blockUser(req: { requesterUid?: string; targetUid?: string }) {
    const uid = await firstValueFrom(this.uid$.pipe(filter(Boolean), take(1)));
    const otherUid = req.requesterUid ?? req.targetUid;
    if (!uid || !otherUid) return;

    const ok = window.confirm(
      'Bloquear este usuário? Você poderá desbloquear depois nas configurações.'
    );
    if (!ok) return;

    this.store.dispatch(A.blockUser({ ownerUid: uid, targetUid: otherUid }));
  }
}