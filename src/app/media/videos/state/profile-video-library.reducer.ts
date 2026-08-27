import { createFeature, createReducer, on } from '@ngrx/store';

import { ProfileVideoLibraryActions } from './profile-video-library.actions';
import type { IProfileVideoStoredItem } from './profile-video-library.models';

export type ProfileVideoLibraryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProfileVideoLibraryState {
  readonly ownerUid: string | null;
  readonly items: IProfileVideoStoredItem[];
  readonly status: ProfileVideoLibraryStatus;
  readonly errorMessage: string | null;
}

const initialState: ProfileVideoLibraryState = {
  ownerUid: null,
  items: [],
  status: 'idle',
  errorMessage: null,
};

export const profileVideoLibraryFeature = createFeature({
  name: 'profileVideoLibrary',
  reducer: createReducer(
    initialState,
    on(ProfileVideoLibraryActions.watchRequested, (_state, { ownerUid }) => ({
      ownerUid,
      items: [],
      status: 'loading' as const,
      errorMessage: null,
    })),
    on(
      ProfileVideoLibraryActions.snapshotReceived,
      (state, { ownerUid, items }) =>
        state.ownerUid === ownerUid
          ? {
              ...state,
              items,
              status: 'ready' as const,
              errorMessage: null,
            }
          : state
    ),
    on(ProfileVideoLibraryActions.watchFailed, (state, { ownerUid, message }) =>
      state.ownerUid === ownerUid
        ? {
            ...state,
            items: [],
            status: 'error' as const,
            errorMessage: message,
          }
        : state
    ),
    on(ProfileVideoLibraryActions.watchStopped, () => initialState)
  ),
});
