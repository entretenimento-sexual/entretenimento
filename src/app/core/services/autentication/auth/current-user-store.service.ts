// src/app/core/services/autentication/auth/current-user-store.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { CacheService } from '@core/services/general/cache/cache.service';

// ⬇️ use o Auth de @angular/fire/auth (combina com provideAuth do AppModule)
import { Auth } from '@angular/fire/auth';

@Injectable({ providedIn: 'root' })
export class CurrentUserStoreService {
  private readonly keyUser = 'currentUser';
  private readonly keyUid = 'currentUserUid';

  private userSubject = new BehaviorSubject<IUserDados | null>(null);
  readonly user$: Observable<IUserDados | null> = this.userSubject.asObservable();

  constructor(
    private cache: CacheService,
    // ⬇️ injeta diretamente o Auth
    private auth: Auth,
  ) { }

  set(user: IUserDados): void {
    if (!user || !user.uid) return;
    const current = this.userSubject.value;
    if (JSON.stringify(current) === JSON.stringify(user)) return;

    this.userSubject.next(user);

    localStorage.setItem(this.keyUser, JSON.stringify(user));
    localStorage.setItem(this.keyUid, user.uid);

    this.cache.set(this.keyUid, user.uid, 300_000);
  }

  clear(): void {
    this.userSubject.next(null);
    localStorage.removeItem(this.keyUser);
    localStorage.removeItem(this.keyUid);
    this.cache.delete(this.keyUid);
  }

  restoreFromCache(): IUserDados | null {
    const raw = localStorage.getItem(this.keyUser);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as IUserDados;
      const authUid = this.auth.currentUser?.uid ?? null;

      if (parsed?.uid && authUid && parsed.uid === authUid) {
        this.userSubject.next(parsed);
        this.cache.set(this.keyUid, parsed.uid, 300_000);
        return parsed;
      }

      localStorage.removeItem(this.keyUser);
      return null;
    } catch {
      return null;
    }
  }

  getLoggedUserUID$(): Observable<string | null> {
    return this.user$.pipe(
      map(u => u?.uid ?? null),
      distinctUntilChanged(),
    );
  }

  getLoggedUserUIDSnapshot(): string | null {
    const fromState = this.userSubject.value?.uid ?? null;
    if (fromState) return fromState;

    const fromCache = this.cache.getSync<string>(this.keyUid);
    if (fromCache) return fromCache;

    return this.auth.currentUser?.uid ?? null;
  }
}
