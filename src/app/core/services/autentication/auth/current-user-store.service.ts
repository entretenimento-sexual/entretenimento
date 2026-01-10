// src/app/core/services/autentication/auth/current-user-store.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { distinctUntilChanged, map, take } from 'rxjs/operators';
import { IUserDados } from '@core/interfaces/iuser-dados';
import { CacheService } from '@core/services/general/cache/cache.service';
import { AuthSessionService } from './auth-session.service';
import { Auth } from '@angular/fire/auth';

@Injectable({ providedIn: 'root' })
export class CurrentUserStoreService {
  private readonly keyUser = 'currentUser';
  private readonly keyUid = 'currentUserUid'; // pode virar compat (opcional)

  private userSubject = new BehaviorSubject<IUserDados | null | undefined>(undefined);
  readonly user$: Observable<IUserDados | null | undefined> = this.userSubject.asObservable();

  constructor(
    private cache: CacheService,
    private authSession: AuthSessionService,
    private auth: Auth, // pode manter só pra restore snapshot
  ) { }

  private ls(): any {
    try { return (globalThis as any)?.localStorage ?? null; } catch { return null; }
  }

  set(user: IUserDados): void {
    if (!user?.uid) return;

    const current = this.userSubject.value;
    if (current && JSON.stringify(current) === JSON.stringify(user)) return;

    this.userSubject.next(user);

    const ls = this.ls();
    if (ls) {
      ls.setItem(this.keyUser, JSON.stringify(user));

      // 🔸 se quiser manter o keyUid, trate como DERIVADO/COMPAT
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

      // ✅ só restaura se bater com o UID do Auth atual
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

  /** ✅ agora UID vem do AuthSession (fonte da verdade) */
  getLoggedUserUID$(): Observable<string | null> {
    return this.authSession.uid$;
  }

  /** snapshot: também prioriza Auth; cache só como compat */
  getLoggedUserUIDSnapshot(): string | null {
    return this.auth.currentUser?.uid
      ?? this.cache.getSync<string>(this.keyUid)
      ?? this.userSubject.value?.uid
      ?? null;
  }

  /** opcional: quando você quer “um valor agora”, sem ficar ouvindo */
  getLoggedUserUIDOnce$(): Observable<string | null> {
    return this.getLoggedUserUID$().pipe(take(1));
  }
}

/* AuthSession manda no UID
CurrentUserStore manda no IUserDados
qualquer UID fora disso vira derivado / compat
Sempre verificar se o UID bate com o IUserDados e manter padronizado.
Nunca esquecer de ferramentas de debug
É assim que funcionam as grandes plataformas?*/
