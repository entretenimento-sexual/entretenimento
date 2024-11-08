// src/app/store/reducers/reducers.user/combine.reducers.ts
import { ActionReducerMap } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { authReducer } from './auth.reducer';
import { fileReducer } from './file.reducer';
import { termsReducer } from './terms.reducer';
import { userReducer } from './user.reducer';

import { chatReducer } from '../reducers.chat/chat.reducer';
import { inviteReducer } from '../reducers.chat/invite.reducer';
import { roomReducer } from '../reducers.chat/room.reducer';
import { locationReducer } from '../reducers.location/location.reducer';

export const reducers: ActionReducerMap<AppState> = {
  user: userReducer,
  terms: termsReducer,
  file: fileReducer,
  auth: authReducer,
  location: locationReducer,
  chat: chatReducer,
  invite: inviteReducer,
  room: roomReducer,
};
