// src/app/store/actions/actions.location/nearby-profiles.actions.ts
import { createActionGroup, props } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { NearbyQueryParams } from '../../states/states.location/nearby-profiles.state';

export const NearbyProfilesActions = createActionGroup({
  source: 'Nearby Profiles',
  events: {
    load: props<{ params: NearbyQueryParams; force?: boolean }>(),
    loaded: props<{ key: string; list: IUserDados[]; updatedAt: number }>(),
    error: props<{ key: string; message: string }>(),
    invalidate: props<{ key?: string }>(),
  },
});
