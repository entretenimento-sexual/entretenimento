// src/app/store/actions/actions.user/file.actions.ts
import { createAction, props } from '@ngrx/store';

import { FileUploadContext } from '../../states/states.user/file.state';

/**
 * O Store acompanha apenas a projeção serializável do upload.
 *
 * SUPRESSÃO EXPLÍCITA:
 * - File, Blob, UploadTask, path de Storage, URL de acesso e UID não trafegam
 *   nas actions persistidas pelo NgRx;
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

/**
 * Compatibilidade temporária com o chamador legado do StorageService.
 *
 * SUPRESSÃO EXPLÍCITA:
 * o argumento `{ url }` é recebido somente na borda do creator e descartado.
 * O objeto NgRx contém apenas `completed: true`, portanto URL/path não entram
 * na action persistida, no Store nem no DevTools. O valor real continua sendo
 * devolvido ao chamador pelo Observable<string> do StorageService.
 */
export const uploadSuccess = createAction(
  '[File] Upload Success',
  (_legacyRuntimeResult?: { readonly url?: string }) => ({
    completed: true as const,
  })
);

export const uploadError = createAction(
  '[File] Upload Error',
  props<{ error: string }>()
);
