//src\app\store\actions\file.actions.ts
import { createAction, props } from '@ngrx/store';

export const uploadStart = createAction('[File] Upload Start',
  props<{ file: File; path: string; userId: string; fileName: string }>());

export const uploadProgress = createAction('[File] Upload Progress',
  props<{ progress: number }>());

export const uploadSuccess = createAction('[File] Upload Success',
  props<{ url: string }>());
  
export const uploadError = createAction('[File] Upload Error',
  props<{ error: string }>());
