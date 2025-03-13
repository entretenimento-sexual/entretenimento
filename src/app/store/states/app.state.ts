// src/app/store/states/app.state.ts
import { cacheReducer } from "../reducers/cache.reducer";
import { chatReducer } from "../reducers/reducers.chat/chat.reducer";
import { inviteReducer } from "../reducers/reducers.chat/invite.reducer";
import { roomReducer } from "../reducers/reducers.chat/room.reducer";
import { locationReducer } from "../reducers/reducers.location/location.reducer";
import { authReducer } from "../reducers/reducers.user/auth.reducer";
import { fileReducer } from "../reducers/reducers.user/file.reducer";
import { termsReducer } from "../reducers/reducers.user/terms.reducer";
import { userReducer } from "../reducers/reducers.user/user.reducer";
import { friendsReducer } from "../reducers/reducers.interactions/friends.reduce";

export interface AppState {
  authState: ReturnType<typeof authReducer>;
  user: ReturnType<typeof userReducer>;
  terms: ReturnType<typeof termsReducer>;
  file: ReturnType<typeof fileReducer>;
  location: ReturnType<typeof locationReducer>;
  chat: ReturnType<typeof chatReducer>;
  invite: ReturnType<typeof inviteReducer>;
  room: ReturnType<typeof roomReducer>;
  cache: ReturnType<typeof cacheReducer>;
  friends: ReturnType<typeof friendsReducer>;
}
