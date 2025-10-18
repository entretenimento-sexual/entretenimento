// src/app/layout/friend.management/friend-list/friend-list.component.ts
import { ChangeDetectionStrategy, Component, OnInit, input, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store, select } from '@ngrx/store';
import { Observable, combineLatest, map, tap, catchError, of, startWith, switchMap, timer } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { AppState } from 'src/app/store/states/app.state';
import { Friend } from 'src/app/core/interfaces/friendship/friend.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { environment } from 'src/environments/environment';
import { toObservable } from '@angular/core/rxjs-interop';

import { blockUser, loadFriends, /*, blockFriend */
sendFriendRequest} from 'src/app/store/actions/actions.interactions/actions.friends';
import {
  selectAllFriends,
  selectFriendsLoading,
  selectFriendsError,
  selectFriendsCount,
} from 'src/app/store/selectors/selectors.interactions/friend.selector';
import { selectFriendsVM, FriendVM } from 'src/app/store/selectors/selectors.interactions/friend.selector';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-friend-list',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, RouterModule],
  templateUrl: './friend-list.component.html',
  styleUrls: ['./friend-list.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendListComponent implements OnInit {
  // inputs (Signal Inputs)
  readonly user = input.required<IUserDados>();
  readonly limit = input<number>();
  readonly displayMode = input<'dashboard' | 'full'>('dashboard');
  readonly sortBy = input<'recent' | 'online' | 'distance' | 'alpha'>('recent');
  readonly filters = input<{ onlyOnline?: boolean }>({});
  // signals to observables
  readonly sortBy$ = toObservable(this.sortBy);
  readonly filters$ = toObservable(this.filters);

  private store = inject<Store<AppState>>(Store as any);
  private notifier = inject(ErrorNotificationService);

  // observables
  friendsRaw$!: Observable<FriendVM[]>;   // agora vem do selectFriendsVM
  loading$!: Observable<boolean>;
  error$!: Observable<string | null>;
  totalCount$!: Observable<number>;

  visibleFriends$!: Observable<FriendVM[]>;
  showSeeAll$!: Observable<boolean>;
  hasFriends$!: Observable<boolean>;
  emptyAfterLoad$!: Observable<boolean>;
  loadingSafe$!: Observable<boolean>;

  ngOnInit(): void {
    const u = this.user();
    if (!u?.uid) return;

    // 1) load idempotente
    this.store.dispatch(loadFriends({ uid: u.uid }));

    // 2) seletores
    // ❗️ANTES: this.friends$ = selectAllFriends (SUPRIMIDO como fonte primária p/ visible)
    // ✅ AGORA:
    this.friendsRaw$ = this.store.pipe(select(selectFriendsVM));
    this.loading$ = this.store.pipe(select(selectFriendsLoading));
    this.error$ = this.store.pipe(select(selectFriendsError));
    this.totalCount$ = this.store.pipe(select(selectFriendsCount));

    const limit = this.limit() ?? 0;

    // 3) Ordenação + Filtro + Limit
    this.visibleFriends$ = combineLatest([
      this.friendsRaw$,
      this.sortBy$,
      this.filters$,
    ]).pipe(
      map(([list, sortBy, filters]) => {
        let acc = [...list];
        if (filters?.onlyOnline) acc = acc.filter(f => f.isOnline);
        switch (sortBy) {
          case 'online': acc.sort((a, b) => Number(b.isOnline) - Number(a.isOnline)); break;
          case 'distance': acc.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)); break;
          case 'alpha': acc.sort((a, b) => (a.nickname ?? '').localeCompare(b.nickname ?? '')); break;
          case 'recent':
          default: acc.sort((a, b) => (b.lastInteractionAt ?? 0) - (a.lastInteractionAt ?? 0)); break;
        }
        if (limit > 0) acc = acc.slice(0, limit);
        if (!environment.production) console.log('[FriendList] visibleFriends$', { limit, sortBy, filters, count: acc.length });
        return acc;
      })
    );

    // loadingSafe
    this.loadingSafe$ = combineLatest([this.loading$, this.totalCount$]).pipe(
      switchMap(([loading, count]) => {
        if (!loading) return of(false);
        if (count > 0) return of(false);
        return timer(5000).pipe(map(() => false), startWith(true));
      })
    );

    this.hasFriends$ = this.totalCount$.pipe(map(c => c > 0));

    this.emptyAfterLoad$ = combineLatest([this.loadingSafe$, this.totalCount$]).pipe(
      map(([loadingSafe, count]) => !loadingSafe && count === 0),
      tap(v => !environment.production && console.log('[FriendList] emptyAfterLoad =', v))
    );

    this.showSeeAll$ = this.totalCount$.pipe(map(count => (limit > 0 ? count > limit : count > 0)));

    if (!environment.production) {
      this.loading$.subscribe(l => console.log('[FriendList] loading =', l));
      this.totalCount$.subscribe(c => console.log('[FriendList] totalCount =', c));
      this.error$.subscribe(e => e && console.warn('[FriendList] error =', e));
    }
  }

  trackByFriend = (_: number, f: FriendVM) => f.friendUid;

  removeFriend(friendUid: string): void {
    const u = this.user();
    if (!u?.uid) return;
    this.store.dispatch(blockUser({ ownerUid: u.uid, targetUid: friendUid })); // ⬅️ via effect
  }

  inviteFriend(friendUid: string): void {
    const u = this.user();
    if (!u?.uid) return;

    // ✅ Usar as props corretas do action
    this.store.dispatch(sendFriendRequest({ requesterUid: u.uid, targetUid: friendUid }));
  // opcional: incluir message -> { userUid: u.uid, friendUid, message: 'Vamos nos conectar!' }
}
}
