// src/app/core/services/autentication/auth/access-control.service.ts
import { Injectable, inject } from '@angular/core';
import { map, distinctUntilChanged, filter, shareReplay } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { CurrentUserStoreService } from './current-user-store.service';
import type { IUserDados } from '../../../interfaces/iuser-dados';

export type UserRole = IUserDados['role'];
const ROLE_RANK: Record<UserRole, number> = {
  visitante: 0, free: 1, basic: 2, premium: 3, vip: 4,
};

@Injectable({ providedIn: 'root' })
export class AccessControlService {
  private readonly currentUserStore = inject(CurrentUserStoreService);

  /** Espera a resolução inicial (ignora 'undefined'); emite 'visitante' se null */
  private readonly role$ = this.currentUserStore.user$.pipe(
    filter(u => u !== undefined),                       // só decide após resolver (null|user)
    map(u => (u?.role ?? 'visitante') as UserRole),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  hasAtLeast$(min: UserRole): Observable<boolean> {
    return this.role$.pipe(map(r => ROLE_RANK[r] >= ROLE_RANK[min]));
  }

  hasAny$(allowed: UserRole[]): Observable<boolean> {
    return this.role$.pipe(map(r => allowed.includes(r)));
  }
}
