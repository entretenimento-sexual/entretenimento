// src/app/store/selectors/selectors.interactions/friends/vm-selectors/outbound.rich.ts
import { createSelector } from '@ngrx/store';
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';
import { selectOutboundRequests } from '../outbound.selectors';
import { pickUser, selectPresenceMap, selectUsersMap, shorten, tsMs } from './vm.utils';

export type OutboundRequestRichVM = (FriendRequest & { id: string }) & {
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

export const selectOutboundRequestsRichVM = createSelector(
  selectOutboundRequests,
  selectUsersMap,
  selectPresenceMap,
  (reqs, users, presence): OutboundRequestRichVM[] =>
    (reqs ?? [])
      .map((r: any) => {
        const u = users[r.targetUid];
        const p = pickUser(u);
        const online = typeof p.isOnline === 'boolean' ? p.isOnline : !!presence[r.targetUid];
        return {
          ...r,
          id: r.id!,
          nickname: p.nickname ?? shorten(r.targetUid),
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
      .sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt))
);
