// src/app/dashboard/principal/principal.component.ts
// Objetivo: dashboard resiliente.
// - UID vem do AUTH (fonte única).
// - Perfil (IUserDados) é usado só para UI (ex.: saudação).
// - Listas e paginações dependem apenas de UID → reduz “tela vazia” no cold start.

import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatOptionModule } from '@angular/material/core';

import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { filter, map, switchMap, take, distinctUntilChanged, tap, shareReplay } from 'rxjs/operators';

import { OnlineUsersComponent } from '../online/online-users/online-users.component';
import { FriendCardsComponent } from 'src/app/layout/friend-management/friend-cards/friend-cards.component';

import { AppState } from 'src/app/store/states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import {
  selectCurrentUser,
  selectCurrentUserUid,
  selectCurrentUserStatus,
} from 'src/app/store/selectors/selectors.user/user.selectors';

import { selectFriendsCount, selectInboundRequestsCount } from 'src/app/store/selectors/selectors.interactions/friend.selector';

import {
  selectFriendsPageItems,
  selectFriendsPageLoading,
  selectFriendsPageReachedEnd,
} from 'src/app/store/selectors/selectors.interactions/friends/pagination.selectors';

import * as P from 'src/app/store/actions/actions.interactions/friends/friends-pagination.actions';
import { PAGE_SIZES } from 'src/app/shared/pagination/page.constants';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-principal',
  templateUrl: './principal.component.html',
  styleUrls: ['./principal.component.css'],
  standalone: true,
  imports: [
    CommonModule, RouterModule,
    MatProgressSpinnerModule, MatSlideToggleModule, MatOptionModule, MatSelectModule,
    OnlineUsersComponent, FriendCardsComponent
  ],
})
export class PrincipalComponent implements OnInit {
  private store = inject<Store<AppState>>(Store as any);

  private readonly debug = !environment.production;
  private dbg(msg: string, extra?: unknown) {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.log('[Principal]', msg, extra ?? '');
  }

  // UI: perfil (pode chegar depois) — não deve bloquear fluxos por UID
  currentUser$: Observable<IUserDados | null> = this.store.select(selectCurrentUser);
  currentUserStatus$ = this.store.select(selectCurrentUserStatus);

  // UID: fonte única (AUTH)
  private uid$ = this.store.select(selectCurrentUserUid).pipe(
    map(uid => uid?.trim() || null),
    distinctUntilChanged(),
    tap(uid => this.dbg('authUid$', uid)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // métricas
  pendingRequestsCount$: Observable<number> = this.store.select(selectInboundRequestsCount);
  showSeeAll$: Observable<boolean> = this.store.select(selectFriendsCount).pipe(map(c => c > 6));

  // amigos (paginado por UID do usuário)
  items$: Observable<any[]> = this.uid$.pipe(
    filter((uid): uid is string => !!uid),
    switchMap(uid => this.store.select(selectFriendsPageItems(uid)))
  );

  loading$: Observable<boolean> = this.uid$.pipe(
    filter((uid): uid is string => !!uid),
    switchMap(uid => this.store.select(selectFriendsPageLoading(uid)))
  );

  reachedEnd$: Observable<boolean> = this.uid$.pipe(
    filter((uid): uid is string => !!uid),
    switchMap(uid => this.store.select(selectFriendsPageReachedEnd(uid)))
  );

  // UI local
  readonly expanded = signal<boolean>(false);
  readonly sortBy = signal<'recent' | 'online' | 'distance' | 'alpha'>('online');
  readonly filters = signal<{ onlyOnline?: boolean }>({ onlyOnline: true });

  ngOnInit(): void {
    // Carrega 1ª página dos amigos baseado SOMENTE no UID (mais resiliente)
    this.uid$
      .pipe(filter((uid): uid is string => !!uid), take(1))
      .subscribe(uid => {
        this.dbg('dispatch loadFriendsFirstPage', { uid, pageSize: PAGE_SIZES.FRIENDS_DASHBOARD });
        this.store.dispatch(P.loadFriendsFirstPage({
          uid,
          pageSize: PAGE_SIZES.FRIENDS_DASHBOARD
        }));
      });
  }

  // handlers
  toggleExpand(): void { this.expanded.update(v => !v); }
  onSortChange(value: 'recent' | 'online' | 'distance' | 'alpha'): void { this.sortBy.set(value); }
  onOnlyOnlineToggle(checked: boolean): void {
    this.filters.set({ ...this.filters(), onlyOnline: checked });
  }
}
