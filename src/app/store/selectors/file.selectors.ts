//src\app\store\selectors\file.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../states/app.state';
import { FileState } from '../reducers/file.reducer';

// Seleciona a parte de 'file' do AppState corretamente
export const selectFileState = (state: AppState): FileState => state.file;

// Seleciona se o arquivo está sendo carregado
export const selectFileUploading = createSelector(
  selectFileState,
  (state: FileState) => state.uploading
);

// Seleciona o progresso do upload
export const selectFileProgress = createSelector(
  selectFileState,
  (state: FileState) => state.progress
);

// Seleciona o erro do upload
export const selectFileError = createSelector(
  selectFileState,
  (state: FileState) => state.error
);

// Seleciona o sucesso do upload
export const selectFileSuccess = createSelector(
  selectFileState,
  (state: FileState) => state.success
);

// Seleciona a URL de download do arquivo
export const selectFileDownloadUrl = createSelector(
  selectFileState,
  (state: FileState) => state.downloadUrl
);
