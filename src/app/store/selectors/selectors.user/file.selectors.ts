// src/app/store/selectors/selectors.user/file.selectors.ts
import { createSelector } from '@ngrx/store';

import { AppState } from '../../states/app.state';
import { FileState } from '../../states/states.user/file.state';
import { STORE_FEATURE } from '../../reducers/feature-keys';

export const selectFileState = (state: AppState): FileState =>
  state[STORE_FEATURE.file];

export const selectFileUploading = createSelector(
  selectFileState,
  (state) => state.uploading
);

export const selectFileProgress = createSelector(
  selectFileState,
  (state) => state.progress
);

export const selectFileError = createSelector(
  selectFileState,
  (state) => state.error
);

export const selectFileSuccess = createSelector(
  selectFileState,
  (state) => state.success
);

export const selectFileDownloadUrl = createSelector(
  selectFileState,
  (state) => state.downloadUrl
);

export const selectActiveFileUpload = createSelector(
  selectFileState,
  (state) => state.activeUpload
);
