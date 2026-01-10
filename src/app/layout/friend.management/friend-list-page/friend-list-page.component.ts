// src/app/layout/friend.management/friend-list-page/friend-list-page.component.ts
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, ViewChild,
         computed, inject, signal, } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, Subscription, combineLatest } from 'rxjs';
import { filter, map, switchMap, take } from 'rxjs/operators';

import { AppState } from 'src/app/store/states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';

import * as P from 'src/app/store/actions/actions.interactions/friends/friends-pagination.actions';
import { selectFriendsPageItems,  selectFriendsPageLoading,  selectFriendsPageReachedEnd,
         selectFriendsPageOnlineCount,  selectFriendsPageCount,
        } from 'src/app/store/selectors/selectors.interactions/friends/pagination.selectors';

// Se preferir, troque por seu componente de card
import { SharedMaterialModule } from 'src/app/shared/shared-material.module';

import { FriendCardsComponent } from '../friend-cards/friend-cards.component';

@Component({
  selector: 'app-friend-list-page',
  standalone: true,
  imports: [CommonModule, SharedMaterialModule, FriendCardsComponent,],
  templateUrl: './friend-list-page.component.html',
  styleUrls: ['./friend-list-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendListPageComponent implements OnInit, OnDestroy {
  private store = inject<Store<AppState>>(Store as any);
  trackByUid = (_: number, f: any) => f?.uid || f?.id;

  // Store base
  currentUser$: Observable<IUserDados | null> = this.store.select(selectCurrentUser);

  // Signals de UI
  sortBy = signal<'recent' | 'online' | 'distance' | 'alpha'>('recent');
  filters = signal<{ onlyOnline?: boolean; q?: string }>({ onlyOnline: false, q: '' });
  hasQuery = computed(() => !!this.filters().q?.trim());

  // Projeções dependentes do UID atual
  items$ = this.currentUser$.pipe(
    filter((u): u is IUserDados => !!u?.uid),
    // seleciona itens direto do slice paginado
    switchMap((u) => this.store.select(selectFriendsPageItems(u.uid)).pipe(
      map(items => this.applyLocalView(items))
    ))
  );

  loading$ = this.currentUser$.pipe(
    filter((u): u is IUserDados => !!u?.uid),
    switchMap(u => this.store.select(selectFriendsPageLoading(u.uid)))
  );

  reachedEnd$ = this.currentUser$.pipe(
    filter((u): u is IUserDados => !!u?.uid),
    switchMap(u => this.store.select(selectFriendsPageReachedEnd(u.uid)))
  );

  friendsCount$ = this.currentUser$.pipe(
    filter((u): u is IUserDados => !!u?.uid),
    switchMap(u => this.store.select(selectFriendsPageCount(u.uid)))
  );

  onlineCount$ = this.currentUser$.pipe(
    filter((u): u is IUserDados => !!u?.uid),
    switchMap(u => this.store.select(selectFriendsPageOnlineCount(u.uid)))
  );

  // Métricas que você tinha (pendentes/bloqueados) podem continuar vindo de outros selectors globais
  pendingRequestsCount$ = this.friendsCount$.pipe(map(() => 0)); // placeholder
  blockedCount$ = this.friendsCount$.pipe(map(() => 0)); // placeholder

  // Infinite scroll
  @ViewChild('sentinel', { static: true }) sentinel!: ElementRef<HTMLDivElement>;
  private io?: IntersectionObserver;
  private sub?: Subscription;

  ngOnInit(): void {
    // primeira página
    this.currentUser$.pipe(filter(u => !!u?.uid), take(1)).subscribe(u => {
      this.store.dispatch(P.loadFriendsFirstPage({ uid: u!.uid, pageSize: 24 }));
      this.setupInfiniteScroll(u!.uid);
    });
  }

  private setupInfiniteScroll(uid: string) {
    const rootMargin = '1200px';
    this.io = new IntersectionObserver((entries) => {
      const e = entries[0];
      if (!e?.isIntersecting) return;

      // checa loading/end uma vez por disparo
      this.sub?.unsubscribe();
      this.sub = combineLatest([
        this.store.select(selectFriendsPageReachedEnd(uid)),
        this.store.select(selectFriendsPageLoading(uid)),
      ])
        .pipe(take(1))
        .subscribe(([end, loading]) => {
          if (!end && !loading) {
            this.store.dispatch(P.loadFriendsNextPage({ uid, pageSize: 24 }));
          }
        });
    }, { root: null, rootMargin, threshold: 0 });

    if (this.sentinel?.nativeElement) {
      this.io.observe(this.sentinel.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.io?.disconnect();
    this.sub?.unsubscribe();
  }

  // === View helpers ===
  onSortChange(v: 'recent' | 'online' | 'distance' | 'alpha') { this.sortBy.set(v); }
  onOnlyOnlineToggle(checked: boolean) { this.filters.update(f => ({ ...f, onlyOnline: checked })); }
  onQueryChange(q: string) { this.filters.update(f => ({ ...f, q })); }

  private applyLocalView(items: any[]) {
    const { onlyOnline, q } = this.filters();
    let out = items ?? [];

    if (onlyOnline) out = out.filter(f => !!f.isOnline);
    if (q && q.trim()) {
      const needle = q.trim().toLowerCase();
      out = out.filter((f) => {
        const name = (f?.name || f?.displayName || f?.nickname || '').toLowerCase();
        return name.includes(needle);
      });
    }

    switch (this.sortBy()) {
      case 'online':
        out = [...out].sort((a, b) => Number(b.isOnline) - Number(a.isOnline));
        break;
      case 'alpha':
        out = [...out].sort((a, b) => (a?.name || '').localeCompare(b?.name || ''));
        break;
      case 'distance':
        out = [...out].sort((a, b) => (a?.distance ?? Infinity) - (b?.distance ?? Infinity));
        break;
      default: // 'recent'
        out = [...out].sort((a, b) => (b?.lastInteractionAt ?? 0) - (a?.lastInteractionAt ?? 0));
        break;
    }
    return out;
  }
}
