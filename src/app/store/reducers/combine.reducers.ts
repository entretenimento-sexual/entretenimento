// src\app\store\reducers\combine.reducers.ts
import { ActionReducerMap } from '@ngrx/store';
import { authReducer } from './auth.reducer';
import { onlineUsersReducer } from './online-users.reducer';
import { userReducer } from './user.reducer'; // Adicionar o reducer do user
import { termsReducer } from './terms.reducer'; // Adicionar o reducer de termos
import { fileReducer } from './file.reducer'; // Adicionar o reducer de arquivos
import { AppState } from '../states/app.state';

export const reducers: ActionReducerMap<AppState> = {
  user: userReducer,          // Adicionar o reducer de user
  terms: termsReducer,        // Adicionar o reducer de termos
  file: fileReducer,          // Adicionar o reducer de arquivos
  auth: authReducer,          // Reducer de autenticação
  onlineUsers: onlineUsersReducer,  // Reducer de usuários online
};
