//src\app\store\effects\file.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { map, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { uploadError, uploadStart, uploadSuccess } from '../../actions/actions.user/file.actions';

@Injectable()
export class FileEffects {
  constructor(
    private actions$: Actions,
    private storageService: StorageService
  ) { }

  uploadFile$ = createEffect(() =>
    this.actions$.pipe(
      ofType(uploadStart),
      switchMap(action =>
        this.storageService.uploadFile(action.file, action.path, action.userId).pipe(
          map(downloadUrl => uploadSuccess({ url: downloadUrl })),
          catchError(error => of(uploadError({ error: error.message })))
        )
      )
    )
  );
}
