// src/app/core/services/autentication/auth/current-user-store.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { IUserDados } from '@core/interfaces/iuser-dados';
import { CacheService } from '@core/services/general/cache/cache.service';
import { Auth } from '@angular/fire/auth';

@Injectable({ providedIn: 'root' })
export class CurrentUserStoreService {
  private readonly keyUser = 'currentUser';
  private readonly keyUid = 'currentUserUid';

  private userSubject = new BehaviorSubject<IUserDados | null | undefined>(undefined);
  readonly user$: Observable<IUserDados | null | undefined> = this.userSubject.asObservable();

  constructor(private cache: CacheService, private auth: Auth) { }

  /** Helper seguro para acessar localStorage (sem quebrar typings). */
  private ls(): any {                  // ⬅️ antes: Storage | null
    try { return (globalThis as any)?.localStorage ?? null; } catch { return null; }
  }

  set(user: IUserDados): void {
    if (!user || !user.uid) return;
    const current = this.userSubject.value;
    if (current && JSON.stringify(current) === JSON.stringify(user)) return;

    this.userSubject.next(user);

    const ls = this.ls();
    if (ls) {
      ls.setItem(this.keyUser, JSON.stringify(user));
      ls.setItem(this.keyUid, user.uid);
    }
    this.cache.set(this.keyUid, user.uid, 300_000);
  }

  clear(): void {
    if (this.userSubject.value === null) return;
    this.userSubject.next(null);

    const ls = this.ls();
    if (ls) {
      ls.removeItem(this.keyUser);
      ls.removeItem(this.keyUid);
    }
    this.cache.delete(this.keyUid);
  }

  restoreFromCache(): IUserDados | null {
    const ls = this.ls();
    const raw = ls?.getItem(this.keyUser) ?? null;
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as IUserDados;
      const authUid = this.auth.currentUser?.uid ?? null;
      if (parsed?.uid && authUid && parsed.uid === authUid) {
        this.userSubject.next(parsed);
        this.cache.set(this.keyUid, parsed.uid, 300_000);
        return parsed;
      }
      ls?.removeItem(this.keyUser);
      return null;
    } catch {
      return null;
    }
  }

  getLoggedUserUID$(): Observable<string | null> {
    return this.user$.pipe(map(u => u?.uid ?? null), distinctUntilChanged());
  }

  getLoggedUserUIDSnapshot(): string | null {
    const fromState = this.userSubject.value?.uid ?? null;
    if (fromState) return fromState;
    const fromCache = this.cache.getSync<string>(this.keyUid);
    if (fromCache) return fromCache;
    return this.auth.currentUser?.uid ?? null;
  }
}
