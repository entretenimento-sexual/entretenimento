// src/app/store/states/app.state.ts
import { IUserState } from './user.state';
import { ITermsState } from './terms.state';

export interface AppState {
  user: IUserState;
  terms: ITermsState;
}
