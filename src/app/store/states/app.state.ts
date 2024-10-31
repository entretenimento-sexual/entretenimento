// src/app/store/states/app.state.ts
import { IUserState, IUserState as UserState } from './states.user/user.state';
import { ITermsState as TermsState } from './states.user/terms.state';
import { FileState } from './states.user/file.state';
import { ChatState } from './states.chat/chat.state';
import { InviteState } from './states.chat/invite.state';
import { RoomState } from './states.chat/room.state';

export interface AppState {
  auth: IUserState;
  user: UserState;
  file: FileState;
  terms: TermsState;
  chat: ChatState;
  invite: InviteState;
  room: RoomState;
}
