// src/app/layout/friend.management/friend-list/friend-list.component.ts
import { ChangeDetectionStrategy, Component, OnInit, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store, select } from '@ngrx/store';
import { Observable, combineLatest, map, tap, catchError, of, startWith, switchMap, timer } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { AppState } from 'src/app/store/states/app.state';
import { IFriend } from 'src/app/core/interfaces/friendship/ifriend';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserInteractionsService } from 'src/app/core/services/data-handling/user-interactions.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { environment } from 'src/environments/environment';

import { loadFriends /*, blockFriend */ } from 'src/app/store/actions/actions.interactions/actions.friends';
import {
  selectAllFriends,
  selectFriendsLoading,
  selectFriendsError,
  selectFriendsCount,
} from 'src/app/store/selectors/selectors.interactions/friend.selector';

@Component({
  selector: 'app-friend-list',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule],
  templateUrl: './friend-list.component.html',
  styleUrl: './friend-list.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendListComponent implements OnInit {
  // inputs
  readonly user = input.required<IUserDados>();
  readonly limit = input<number>();

  // injeções (tipadas de forma segura)
  private store = inject<Store<AppState>>(Store as any);
  private interactions = inject(UserInteractionsService);
  private notifier = inject(ErrorNotificationService);

  // observables
  friends$!: Observable<IFriend[]>;
  loading$!: Observable<boolean>;
  error$!: Observable<string | null>;
  totalCount$!: Observable<number>;

  visibleFriends$!: Observable<IFriend[]>;
  showSeeAll$!: Observable<boolean>;
  hasFriends$!: Observable<boolean>;
  emptyAfterLoad$!: Observable<boolean>;
  loadingSafe$!: Observable<boolean>;

  ngOnInit(): void {
    const u = this.user();
    if (!u?.uid) return;

    // 1) dispara o load (idempotente)
    this.store.dispatch(loadFriends({ uid: u.uid }));

    // 2) seletores (sempre inicialize TODOS antes de usar em combineLatest!)
    this.friends$ = this.store.pipe(select(selectAllFriends));
    this.loading$ = this.store.pipe(select(selectFriendsLoading));
    this.error$ = this.store.pipe(select(selectFriendsError));
    this.totalCount$ = this.store.pipe(select(selectFriendsCount));

    const limit = this.limit() ?? 0;

    // 3) listas derivadas
    this.visibleFriends$ = this.friends$.pipe(
      map(list => (limit > 0 ? list.slice(0, limit) : list)),
      tap(list => {
        if (!environment.production) {
          console.log('[FriendList] visibleFriends$', { limit, count: list.length });
        }
      })
    );

    // “loading” à prova de travamento: se ficar loading sem dados > 5s, desliga spinner
    this.loadingSafe$ = combineLatest([this.loading$, this.totalCount$]).pipe(
      switchMap(([loading, count]) => {
        if (!loading) return of(false);
        if (count > 0) return of(false);
        return timer(5000).pipe(
          map(() => false),
          startWith(true)
        );
      })
    );

    this.hasFriends$ = this.totalCount$.pipe(map(c => c > 0));

    // ✅ “vazio” depende do loadingSafe$ (não do loading cru)
    this.emptyAfterLoad$ = combineLatest([this.loadingSafe$, this.totalCount$]).pipe(
      map(([loadingSafe, count]) => !loadingSafe && count === 0),
      tap(v => !environment.production && console.log('[FriendList] emptyAfterLoad =', v))
    );

    // Evite combineLatest com 1 item — use map direto
    this.showSeeAll$ = this.totalCount$.pipe(
      map(count => (limit > 0 ? count > limit : count > 0))
    );

    if (!environment.production) {
      this.loading$.subscribe(l => console.log('[FriendList] loading =', l));
      this.totalCount$.subscribe(c => console.log('[FriendList] totalCount =', c));
      this.error$.subscribe(e => e && console.warn('[FriendList] error =', e));
    }
  }

  trackByFriend = (_: number, f: IFriend) => f.friendUid;

  removeFriend(friendUid: string): void {
    const u = this.user();
    if (!u?.uid) return;

    // Preferível via Effect (blockFriend). Fallback em dev:
    this.interactions.blockUser(u.uid, friendUid).pipe(
      tap(() => this.notifier.showInfo('Usuário removido/bloqueado.')),
      catchError((err: any) => {
        this.notifier.showError('Não foi possível remover o amigo.', err?.message);
        return of(null);
      })
    ).subscribe();
  }
}
