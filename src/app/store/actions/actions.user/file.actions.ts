// src/app/store/actions/actions.user/file.actions.ts
import { createAction, props } from '@ngrx/store';

import { FileUploadContext } from '../../states/states.user/file.state';

/**
 * O Store acompanha apenas a projeção serializável do upload.
 *
 * SUPRESSÃO EXPLÍCITA:
 * - File, Blob, UploadTask, path de Storage e UID não trafegam nesta action;
 * - esses objetos permanecem no service Observable que executa o upload.
 *
 * Motivo: preservar strictActionSerializability, reduzir exposição de dados no
 * DevTools e impedir que o NgRx assuma responsabilidade sobre recursos runtime.
 */
export const uploadStart = createAction(
  '[File] Upload Start',
  props<FileUploadContext>()
);

export const uploadProgress = createAction(
  '[File] Upload Progress',
  props<{ progress: number }>()
);

export const uploadSuccess = createAction(
  '[File] Upload Success',
  props<{ url: string }>()
);

export const uploadError = createAction(
  '[File] Upload Error',
  props<{ error: string }>()
);
