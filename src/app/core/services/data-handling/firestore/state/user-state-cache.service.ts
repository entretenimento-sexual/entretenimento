//src\app\core\services\data-handling\firestore\state\user-state-cache.service.ts
import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs/operators';

import { CacheService } from '@core/services/general/cache/cache.service';
import { AppState } from 'src/app/store/states/app.state';
import { addUserToState, updateUserInState } from 'src/app/store/actions/actions.user/user.actions';
import { IUserDados } from '@core/interfaces/iuser-dados';
import { IUserRegistrationData } from '@core/interfaces/iuser-registration-data';

@Injectable({ providedIn: 'root' })
export class UserStateCacheService {
  constructor(
    private readonly cache: CacheService,
    private readonly store: Store<AppState>
  ) { }

  upsertUser(user: IUserDados, ttlMs = 300_000): void {
    this.store.dispatch(addUserToState({ user }));
    this.cache.set(`user:${user.uid}`, user, ttlMs);
  }

  invalidate(uid: string): void {
    this.cache.set(`user:${uid.trim()}`, null as any, 1);
  }

  updateUserInStateAndCache<T extends IUserRegistrationData | IUserDados>(uid: string, updatedData: T): void {
    const key = `user:${uid}`;
    this.cache.get<T>(key).pipe(take(1)).subscribe(existing => {
      if (existing && JSON.stringify(existing) === JSON.stringify(updatedData)) return;
      this.cache.set(key, updatedData, 300_000);
      this.store.dispatch(updateUserInState({ uid, updatedData } as any));
    });
  }
}
