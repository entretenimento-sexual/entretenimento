// src/app/store/states/states.user/file.state.ts
export type FileUploadKind = 'image' | 'video' | 'avatar';

/**
 * Metadados seguros e serializáveis usados somente para feedback e debug.
 * Não contém conteúdo binário, UID, nome original ou path de Storage.
 */
export interface FileUploadContext {
  readonly uploadId: string;
  readonly kind: FileUploadKind;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

export interface FileState {
  readonly uploading: boolean;
  readonly progress: number;
  readonly error: string | null;
  readonly success: boolean;
  readonly downloadUrl: string | null;
  readonly activeUpload: FileUploadContext | null;
}

export const initialFileState: FileState = {
  uploading: false,
  progress: 0,
  error: null,
  success: false,
  downloadUrl: null,
  activeUpload: null,
};
