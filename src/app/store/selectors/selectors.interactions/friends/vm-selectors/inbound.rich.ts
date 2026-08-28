// src/app/store/selectors/selectors.interactions/friends/vm-selectors/inbound.rich.ts
import { createSelector } from '@ngrx/store';
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';
import { selectInboundRequests } from '../inbound.selectors';
import { pickUser, selectPresenceMap, selectUsersMap, shorten, tsMs } from './vm.utils';

export type InboundRequestRichVM = (FriendRequest & { id: string }) & {
  nickname: string;
  avatarUrl?: string;
  gender?: string;
  orientation?: string;
  municipio?: string;
  estado?: string;
  isOnline?: boolean;
  lastSeen?: any;
  role?: string;
  age?: number;
  photos?: string[];
};

export const selectInboundRequestsRichVM = createSelector(
  selectInboundRequests,
  selectUsersMap,
  selectPresenceMap,
  (reqs, users, presence): InboundRequestRichVM[] =>
    (reqs ?? [])
      .map((r: any) => {
        const u = users[r.requesterUid];
        const p = pickUser(u);
        const online =
          presence[r.requesterUid] === true
            ? true
            : (typeof p.isOnline === 'boolean' ? p.isOnline : false);
        return {
          ...r,
          id: r.id!,
          nickname: p.nickname ?? shorten(r.requesterUid),
          avatarUrl: p.avatarUrl,
          gender: p.gender,
          orientation: p.orientation,
          municipio: p.municipio,
          estado: p.estado,
          isOnline: online,
          lastSeen: p.lastSeen,
          role: p.role,
          age: p.age,
          photos: p.photos,
        };
      })
      .sort((a: InboundRequestRichVM, b: InboundRequestRichVM) => tsMs(b.createdAt) - tsMs(a.createdAt))
);
