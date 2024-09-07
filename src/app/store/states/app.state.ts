// src/app/store/states/app.state.ts
import { UserState } from './user.state';

export interface AppState {
  user: UserState;  // define o estado global da aplicação
}
