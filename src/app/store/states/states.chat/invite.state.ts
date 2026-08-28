// src/app/store/states/states.chat/invite.state.ts
import { InviteInboxItem } from 'src/app/core/interfaces/interfaces-chat/invite.interface';

/** Estado global do inbox, sempre pertencente a um único UID. */
export interface InviteState {
  readonly ownerUid: string | null;
  readonly invites: readonly InviteInboxItem[];
  readonly loading: boolean;
  readonly loaded: boolean;
  readonly error: string | null;
}

export const initialInviteState: InviteState = {
  ownerUid: null,
  invites: [],
  loading: false,
  loaded: false,
  error: null,
};
