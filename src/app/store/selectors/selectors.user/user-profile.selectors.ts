// src/app/store/selectors/user/user-profile.selectors.ts
import { createSelector } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { selectCurrentUser, selectUsersMap } from '../selectors.user/user.selectors';

