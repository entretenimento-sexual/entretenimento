// src/app/store/states/app.state.ts
import { IUserState } from './user.state';
import { ITermsState } from './terms.state';
import { FileState } from './file.state';

export interface AppState {
  user: IUserState;
  terms: ITermsState;
  file: FileState;
}
