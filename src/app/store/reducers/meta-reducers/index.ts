// src/app/store/reducers/meta-reducers/index.ts
// Não esqueça os comentários
import { MetaReducer } from '@ngrx/store';
import { AppState } from '../../states/app.state';

import { resetStoreOnAuthChangeMetaReducer } from './reset-store-on-auth-change.metareducer';

/**
 * Lista única de metaReducers do app.
 * Mantém o StoreModule.forRoot limpo e escalável.
 */
export const metaReducers: MetaReducer<AppState>[] = [
  resetStoreOnAuthChangeMetaReducer,
];
