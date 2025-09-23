// src/app/core/services/autentication/auth/current-user-store.service.ts
import { Injectable, Inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { IUserDados } from '@core/interfaces/iuser-dados';
import { CacheService } from '@core/services/general/cache/cache.service';
import { FIREBASE_AUTH } from '@core/firebase/firebase.tokens';
import type { Auth } from 'firebase/auth';

@Injectable({ providedIn: 'root' })
export class CurrentUserStoreService {
  private readonly keyUser = 'currentUser';
  private readonly keyUid = 'currentUserUid';

  private userSubject = new BehaviorSubject<IUserDados | null>(null);
  readonly user$: Observable<IUserDados | null> = this.userSubject.asObservable();

  constructor(
    private cache: CacheService,
    @Inject(FIREBASE_AUTH) private auth: Auth,
  ) { }

  set(user: IUserDados): void {
    if (!user || !user.uid) return;
    const current = this.userSubject.value;
    if (JSON.stringify(current) === JSON.stringify(user)) return;

    this.userSubject.next(user);

    // 🔒 Persistências síncronas para fallback rápido
    localStorage.setItem(this.keyUser, JSON.stringify(user));
    localStorage.setItem(this.keyUid, user.uid);

    // ❄ Cache em memória + IndexedDB
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

      // ✅ Só restaura se o Auth atual existe E bate com o cache
      if (parsed?.uid && authUid && parsed.uid === authUid) {
        this.userSubject.next(parsed);
        this.cache.set(this.keyUid, parsed.uid, 300_000);
        return parsed;
      }

      // ❌ Caso contrário, limpa o espelho para não “reviver” sessão morta
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
    // 1) estado atual
    const fromState = this.userSubject.value?.uid ?? null;
    if (fromState) return fromState;

    // 2) cache síncrono (memória ou localStorage)
    const fromCache = this.cache.getSync<string>(this.keyUid);
    if (fromCache) return fromCache;

    // 3) fallback Auth
    return this.auth.currentUser?.uid ?? null;
  }
}
