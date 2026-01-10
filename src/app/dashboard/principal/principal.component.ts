// src/app/dashboard/principal/principal.component.ts
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatOptionModule } from '@angular/material/core';

import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { filter, map, switchMap, take } from 'rxjs/operators';

import { OnlineUsersComponent } from '../online/online-users/online-users.component';
import { FriendCardsComponent } from 'src/app/layout/friend.management/friend-cards/friend-cards.component';

import { AppState } from 'src/app/store/states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';

import {
  selectFriendsCount,
  selectFriendsLoading,
  selectFriendsVM,
  selectInboundRequestsCount
} from 'src/app/store/selectors/selectors.interactions/friend.selector';

import {
  selectFriendsPageItems,
  selectFriendsPageLoading,
  selectFriendsPageReachedEnd,
} from 'src/app/store/selectors/selectors.interactions/friends/pagination.selectors';

import * as P from 'src/app/store/actions/actions.interactions/friends/friends-pagination.actions';
import { PAGE_SIZES } from 'src/app/shared/pagination/page.constants';

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

  // usuário / métricas
  currentUser$: Observable<IUserDados | null> = this.store.select(selectCurrentUser);
  pendingRequestsCount$: Observable<number> = this.store.select(selectInboundRequestsCount);

  // métrica para exibir “Ver Todos” no dashboard
  showSeeAll$: Observable<boolean> = this.store.select(selectFriendsCount).pipe(map(c => c > 6));

  // amigos (paginado por UID do usuário) — estes alimentam o grid
  items$: Observable<any[]> = this.currentUser$.pipe(
    filter((u): u is IUserDados => !!u?.uid),
    switchMap(u => this.store.select(selectFriendsPageItems(u.uid)))
  );

  loading$: Observable<boolean> = this.currentUser$.pipe(
    filter((u): u is IUserDados => !!u?.uid),
    switchMap(u => this.store.select(selectFriendsPageLoading(u.uid)))
  );

  reachedEnd$: Observable<boolean> = this.currentUser$.pipe(
    filter((u): u is IUserDados => !!u?.uid),
    switchMap(u => this.store.select(selectFriendsPageReachedEnd(u.uid)))
  );

  // UI local
  readonly expanded = signal<boolean>(false);
  readonly sortBy = signal<'recent' | 'online' | 'distance' | 'alpha'>('online');
  readonly filters = signal<{ onlyOnline?: boolean }>({ onlyOnline: true });

  ngOnInit(): void {
    // carrega a 1ª página dos amigos para o dashboard (ex.: 8)
    this.currentUser$
      .pipe(filter(u => !!u?.uid), take(1))
      .subscribe(u => {
        this.store.dispatch(P.loadFriendsFirstPage({
          uid: u!.uid,
          pageSize: PAGE_SIZES.FRIENDS_DASHBOARD
        }));
      });
  }

  // handlers do toolbar
  toggleExpand(): void { this.expanded.update(v => !v); }
  onSortChange(value: 'recent' | 'online' | 'distance' | 'alpha'): void { this.sortBy.set(value); }
  onOnlyOnlineToggle(checked: boolean): void {
    this.filters.set({ ...this.filters(), onlyOnline: checked });
  }
}
