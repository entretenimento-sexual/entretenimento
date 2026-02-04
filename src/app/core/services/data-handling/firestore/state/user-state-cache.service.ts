// src/app/core/services/data-handling/firestore/state/user-state-cache.service.ts
// Não esqueça os comentários
import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable, of } from 'rxjs';
import { catchError, take } from 'rxjs/operators';

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

  private norm(uid: string): string {
    return (uid ?? '').toString().trim();
  }

  private key(uid: string): string {
    return `user:${this.norm(uid)}`;
  }

  /**
   * Cache tri-state:
   * - undefined: cache miss (não existe chave)
   * - null: inválido/expirado deliberadamente
   * - IUserDados: valor
   */
  getCachedUser$(uid: string): Observable<IUserDados | null | undefined> {
    const id = this.norm(uid);
    if (!id) return of(undefined);

    return this.cache.get<IUserDados | null>(this.key(id)).pipe(
      catchError(() => of(undefined))
    );
  }

  getCachedUserSnapshot(uid: string): IUserDados | null | undefined {
    const id = this.norm(uid);
    if (!id) return undefined;
    return this.cache.getSync<IUserDados | null>(this.key(id));
  }

  upsertUser(user: IUserDados, ttlMs = 300_000): void {
    if (!user?.uid) return;

    this.store.dispatch(addUserToState({ user }));
    this.cache.set(this.key(user.uid), user, ttlMs);
  }

  invalidate(uid: string): void {
    const id = this.norm(uid);
    if (!id) return;

    // Preferência: delete; fallback: set null curtíssimo.
    try {
      this.cache.delete(this.key(id));
    } catch {
      this.cache.set(this.key(id), null as any, 1);
    }
  }

  updateUserInStateAndCache<T extends IUserRegistrationData | IUserDados>(uid: string, updatedData: T): void {
    const id = this.norm(uid);
    if (!id) return;

    const key = this.key(id);

    this.cache.get<T>(key).pipe(take(1)).subscribe(existing => {
      if (existing && JSON.stringify(existing) === JSON.stringify(updatedData)) return;
      this.cache.set(key, updatedData, 300_000);
      this.store.dispatch(updateUserInState({ uid: id, updatedData } as any));
    });
  }
}
