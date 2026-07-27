// src/app/store/reducers/reducers.user/file.reducer.spec.ts
import {
  uploadError,
  uploadProgress,
  uploadStart,
  uploadSuccess,
} from '../../actions/actions.user/file.actions';
import { initialFileState } from '../../states/states.user/file.state';
import { fileReducer } from './file.reducer';

describe('fileReducer', () => {
  it('uploadStart reinicia feedback anterior e registra somente contexto seguro', () => {
    const previous = {
      ...initialFileState,
      progress: 87,
      success: true,
      error: 'erro antigo',
      downloadUrl: 'https://example.test/old',
    };

    const next = fileReducer(
      previous,
      uploadStart({
        uploadId: 'upload-2',
        kind: 'video',
        sizeBytes: 4096,
        mimeType: 'video/mp4',
      })
    );

    expect(next).toEqual({
      ...initialFileState,
      uploading: true,
      activeUpload: {
        uploadId: 'upload-2',
        kind: 'video',
        sizeBytes: 4096,
        mimeType: 'video/mp4',
      },
    });
  });

  it('uploadProgress normaliza o percentual e mantém o upload ativo', () => {
    const next = fileReducer(
      initialFileState,
      uploadProgress({ progress: 104.7 })
    );

    expect(next.uploading).toBe(true);
    expect(next.progress).toBe(100);
    expect(next.success).toBe(false);
    expect(next.error).toBeNull();
  });

  it('uploadSuccess conclui o ciclo e limpa erro anterior', () => {
    const next = fileReducer(
      {
        ...initialFileState,
        uploading: true,
        progress: 54,
        error: 'transitório',
      },
      uploadSuccess({ url: 'users/u/uploads/images/media.webp' })
    );

    expect(next.uploading).toBe(false);
    expect(next.progress).toBe(100);
    expect(next.success).toBe(true);
    expect(next.error).toBeNull();
    expect(next.downloadUrl).toBe('users/u/uploads/images/media.webp');
  });

  it('uploadError encerra o ciclo sem preservar URL stale', () => {
    const next = fileReducer(
      {
        ...initialFileState,
        uploading: true,
        progress: 32,
        downloadUrl: 'https://example.test/stale',
      },
      uploadError({ error: 'Falha no upload.' })
    );

    expect(next.uploading).toBe(false);
    expect(next.success).toBe(false);
    expect(next.error).toBe('Falha no upload.');
    expect(next.downloadUrl).toBeNull();
  });
});
