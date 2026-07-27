// src/app/store/reducers/reducers.user/file.reducer.ts
import { createReducer, on } from '@ngrx/store';

import {
  uploadError,
  uploadProgress,
  uploadStart,
  uploadSuccess,
} from '../../actions/actions.user/file.actions';
import {
  FileState,
  initialFileState,
} from '../../states/states.user/file.state';

function normalizeProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

export const fileReducer = createReducer(
  initialFileState,

  on(uploadStart, (_state, context): FileState => ({
    ...initialFileState,
    uploading: true,
    activeUpload: {
      uploadId: context.uploadId,
      kind: context.kind,
      sizeBytes: context.sizeBytes,
      mimeType: context.mimeType,
    },
  })),

  on(uploadProgress, (state, { progress }): FileState => ({
    ...state,
    uploading: true,
    progress: normalizeProgress(progress),
    success: false,
    error: null,
  })),

  on(uploadSuccess, (state, { url }): FileState => ({
    ...state,
    uploading: false,
    progress: 100,
    success: true,
    error: null,
    downloadUrl: url,
  })),

  on(uploadError, (state, { error }): FileState => ({
    ...state,
    uploading: false,
    success: false,
    error,
    downloadUrl: null,
  }))
);
