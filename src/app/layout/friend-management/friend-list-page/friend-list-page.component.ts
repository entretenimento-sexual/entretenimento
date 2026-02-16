// src/app/layout/friend-management/friend-list-page/friend-list-page.component.ts
// Componente de listagem de amigos com paginação infinita.
// Usa NgRx para gerenciar estado e interações com a store.
// Permite ordenar por recentes, online, distância ou alfabética.
// Permite filtrar por online e busca textual.
// Exibe contagem total de amigos e quantos estão online.
// Não esqueça de adicionar comentários explicativos e ferramentas de debug para facilitar manutenção futura.
import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, ViewChild,
  computed, inject, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, Subscription, combineLatest } from 'rxjs';
import { filter, map, switchMap, take } from 'rxjs/operators';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppState } from 'src/app/store/states/app.state';
import { selectCurrentUserUid } from 'src/app/store/selectors/selectors.user/user.selectors';

import * as P from 'src/app/store/actions/actions.interactions/friends/friends-pagination.actions';
import {
  selectFriendsPageItems,
  selectFriendsPageLoading,
  selectFriendsPageReachedEnd,
  selectFriendsPageOnlineCount,
  selectFriendsPageCount,
} from 'src/app/store/selectors/selectors.interactions/friends/pagination.selectors';

import { SharedMaterialModule } from 'src/app/shared/shared-material.module';
import { FriendCardsComponent } from '../friend-cards/friend-cards.component';

@Component({
  selector: 'app-friend-list-page',
  standalone: true,
  imports: [CommonModule, SharedMaterialModule, FriendCardsComponent],
  templateUrl: './friend-list-page.component.html',
  styleUrls: ['./friend-list-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FriendListPageComponent implements OnInit, OnDestroy {
  private store = inject<Store<AppState>>(Store as any);
  trackByUid = (_: number, f: any) => f?.uid || f?.id;

  // ✅ UID como fonte única (AUTH)
  private uid$ = this.store.select(selectCurrentUserUid).pipe(
    map(uid => uid?.trim() || null),
    filter((uid): uid is string => !!uid),
  );

  // Signals de UI
  sortBy = signal<'recent' | 'online' | 'distance' | 'alpha'>('recent');
  filters = signal<{ onlyOnline?: boolean; q?: string }>({ onlyOnline: false, q: '' });
  hasQuery = computed(() => !!this.filters().q?.trim());

  private sortBy$ = toObservable(this.sortBy);
  private filters$ = toObservable(this.filters);

  // Store slices por UID
  private itemsFromStore$ = this.uid$.pipe(
    switchMap(uid => this.store.select(selectFriendsPageItems(uid)))
  );

  items$ = combineLatest([this.itemsFromStore$, this.sortBy$, this.filters$]).pipe(
    map(([items, sortBy, filters]) => this.applyLocalView(items ?? [], sortBy, filters))
  );

  loading$ = this.uid$.pipe(
    switchMap(uid => this.store.select(selectFriendsPageLoading(uid)))
  );

  reachedEnd$ = this.uid$.pipe(
    switchMap(uid => this.store.select(selectFriendsPageReachedEnd(uid)))
  );

  friendsCount$ = this.uid$.pipe(
    switchMap(uid => this.store.select(selectFriendsPageCount(uid)))
  );

  onlineCount$ = this.uid$.pipe(
    switchMap(uid => this.store.select(selectFriendsPageOnlineCount(uid)))
  );

  pendingRequestsCount$ = this.friendsCount$.pipe(map(() => 0));
  blockedCount$ = this.friendsCount$.pipe(map(() => 0));

  @ViewChild('sentinel', { static: true }) sentinel!: ElementRef<HTMLDivElement>;
  private io?: IntersectionObserver;
  private sub?: Subscription;

  ngOnInit(): void {
    this.uid$.pipe(take(1), takeUntilDestroyed()).subscribe(uid => {
      this.store.dispatch(P.loadFriendsFirstPage({ uid, pageSize: 24 }));
      this.setupInfiniteScroll(uid);
    });
  }

  private setupInfiniteScroll(uid: string) {
    const rootMargin = '1200px';
    this.io?.disconnect();

    this.io = new IntersectionObserver((entries) => {
      const e = entries[0];
      if (!e?.isIntersecting) return;

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

    if (this.sentinel?.nativeElement) this.io.observe(this.sentinel.nativeElement);
  }

  ngOnDestroy(): void {
    this.io?.disconnect();
    this.sub?.unsubscribe();
  }

  onSortChange(v: 'recent' | 'online' | 'distance' | 'alpha') { this.sortBy.set(v); }
  onOnlyOnlineToggle(checked: boolean) { this.filters.update(f => ({ ...f, onlyOnline: checked })); }
  onQueryChange(q: string) { this.filters.update(f => ({ ...f, q })); }

  private applyLocalView(
    items: any[],
    sortBy: 'recent' | 'online' | 'distance' | 'alpha',
    filters: { onlyOnline?: boolean; q?: string }
  ) {
    const { onlyOnline, q } = filters;
    let out = items ?? [];

    if (onlyOnline) out = out.filter(f => !!f.isOnline);

    if (q && q.trim()) {
      const needle = q.trim().toLowerCase();
      out = out.filter((f) => {
        const name = (f?.name || f?.displayName || f?.nickname || '').toLowerCase();
        return name.includes(needle);
      });
    }

    switch (sortBy) {
      case 'online':
        out = [...out].sort((a, b) => Number(b.isOnline) - Number(a.isOnline));
        break;
      case 'alpha':
        out = [...out].sort((a, b) => (a?.name || '').localeCompare(b?.name || ''));
        break;
      case 'distance':
        out = [...out].sort((a, b) => (a?.distance ?? Infinity) - (b?.distance ?? Infinity));
        break;
      default:
        out = [...out].sort((a, b) => (b?.lastInteractionAt ?? 0) - (a?.lastInteractionAt ?? 0));
        break;
    }

    return out;
  }
} // 160 linhas, mas a maioria é template e estilo. O TS é enxuto e focado em orquestrar dados do store e UI local (sort/filter).
