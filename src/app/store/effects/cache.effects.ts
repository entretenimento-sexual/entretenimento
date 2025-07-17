//src\app\store\effects\cache.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { map, tap } from 'rxjs/operators';
import { CacheService } from '../../core/services/general/cache/cache.service';
import * as CacheActions from '../actions/cache.actions';

@Injectable()
export class CacheEffects {
  constructor(private actions$: Actions, private cacheService: CacheService) { }

  setCache$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CacheActions.setCache),
      tap(action => {
        console.log('[CacheEffects] setCache acionado:', action.key);
        this.cacheService.set(action.key, action.value);
      })
    ),
    { dispatch: false }
  );
}
