//src\app\store\reducers\file.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { uploadError, uploadProgress, uploadStart, uploadSuccess } from '../../actions/actions.user/file.actions';


export interface FileState {
  uploading: boolean;
  progress: number;
  success: boolean;
  error: string | null;
  downloadUrl: string | null;
}

export const initialState: FileState = {
  uploading: false,
  progress: 0,
  success: false,
  error: null,
  downloadUrl: null
};

export const fileReducer = createReducer(
  initialState,
  on(uploadStart, state => ({ ...state, uploading: true, progress: 0, success: false })),
  on(uploadProgress, (state, { progress }) => ({ ...state, progress })),
  on(uploadSuccess, (state, { url }) => ({ ...state, uploading: false, success: true, downloadUrl: url })),
  on(uploadError, (state, { error }) => ({ ...state, uploading: false, success: false, error }))
);
