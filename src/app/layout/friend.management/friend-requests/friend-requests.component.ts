// src/app/layout/friend.management/friend-requests/friend-requests.component.ts
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { map, filter, take, combineLatest } from 'rxjs';
import { AppState } from 'src/app/store/states/app.state';
import { SharedMaterialModule } from 'src/app/shared/shared-material.module';
import { DateFormatPipe } from 'src/app/shared/pipes/date-format.pipe';

import { selectCurrentUserUid } from 'src/app/store/selectors/selectors.user/user.selectors';
import { selectInboundRequests, selectInboundRequestsCount, selectRequestsLoading } from 'src/app/store/selectors/selectors.interactions/friends/inbound.selectors';
import { selectOutboundRequests, selectOutboundRequestsCount, selectOutboundRequestsLoading } from 'src/app/store/selectors/selectors.interactions/friends/outbound.selectors';
import * as A from 'src/app/store/actions/actions.interactions/actions.friends';

@Component({
  selector: 'app-friend-requests',
  standalone: true,
  imports: [CommonModule, SharedMaterialModule, DateFormatPipe], // ⬅️
  templateUrl: './friend-requests.component.html',
  styleUrls: ['./friend-requests.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendRequestsComponent implements OnInit {
  private store = inject(Store) as Store<AppState>;

  uid$ = this.store.select(selectCurrentUserUid);

  // dados
  inbound$ = this.store.select(selectInboundRequests);
  outbound$ = this.store.select(selectOutboundRequests);

  // ✅ VM agregada para a aba “Todas”
  vm$ = combineLatest([this.inbound$, this.outbound$]).pipe(
    map(([inb, outb]) => ({ inbound: inb ?? [], outbound: outb ?? [] }))
  );

  // contadores
  inboundCount$ = this.store.select(selectInboundRequestsCount);
  outboundCount$ = this.store.select(selectOutboundRequestsCount);
  totalCount$ = combineLatest([this.inboundCount$, this.outboundCount$]).pipe(
    map(([a, b]) => (a ?? 0) + (b ?? 0))
  );

  // loading
  loadingInbound$ = this.store.select(selectRequestsLoading);
  loadingOutbound$ = this.store.select(selectOutboundRequestsLoading);
  bothLoading$ = combineLatest([this.loadingInbound$, this.loadingOutbound$]).pipe(
    map(([a, b]) => !!a || !!b)
  );

  ngOnInit(): void {
    this.uid$.pipe(filter(Boolean), take(1)).subscribe(uid => {
      this.store.dispatch(A.loadInboundRequests({ uid: uid! }));
      this.store.dispatch(A.loadOutboundRequests({ uid: uid! }));
    });
  }

  trackById = (_: number, item: any) => item?.id ?? _;
  async acceptRequest(req: { id: string; requesterUid: string }) {
    const uid = await this.uid$.pipe(filter(Boolean), take(1)).toPromise();
    this.store.dispatch(A.acceptFriendRequest({ requestId: req.id, requesterUid: req.requesterUid, targetUid: uid! }));
  }
  declineRequest(req: { id: string }) { this.store.dispatch(A.declineFriendRequest({ requestId: req.id })); }
  cancelRequest(req: { id: string }) { this.store.dispatch(A.cancelFriendRequest({ requestId: req.id })); }
}
