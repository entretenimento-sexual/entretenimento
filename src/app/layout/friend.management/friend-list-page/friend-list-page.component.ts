// src\app\layout\friend.management\friend-list-page\friend-list-page.component.ts
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppState } from 'src/app/store/states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';
import { selectFriendsCount, selectInboundRequestsCount, selectBlockedFriendsCount,
        selectFriendsVM, } from 'src/app/store/selectors/selectors.interactions/friend.selector';
// ✅ Entrando com o módulo centralizado:
import { FriendListComponent } from '../friend-list/friend-list.component';
import { SharedMaterialModule } from 'src/app/shared/shared-material.module';

@Component({
  selector: 'app-friend-list-page',
  standalone: true,
  imports: [CommonModule, FriendListComponent, SharedMaterialModule],
  templateUrl: './friend-list-page.component.html',
  styleUrls: ['./friend-list-page.component.css'],
})
export class FriendListPageComponent {
  private store = inject<Store<AppState>>(Store as any);

  currentUser$: Observable<IUserDados | null> = this.store.select(selectCurrentUser);
  friendsVM$ = this.store.select(selectFriendsVM);
  friendsCount$ = this.store.select(selectFriendsCount);
  pendingRequestsCount$ = this.store.select(selectInboundRequestsCount);
  blockedCount$ = this.store.select(selectBlockedFriendsCount);
  onlineCount$ = this.friendsVM$.pipe(map(list => list.filter(f => f.isOnline).length));

  sortBy = signal<'recent' | 'online' | 'distance' | 'alpha'>('recent');
  filters = signal<{ onlyOnline?: boolean; q?: string }>({ onlyOnline: false, q: '' });

  hasQuery = computed(() => !!this.filters().q?.trim());

  onSortChange(v: 'recent' | 'online' | 'distance' | 'alpha') { this.sortBy.set(v); }
  onOnlyOnlineToggle(checked: boolean) { this.filters.update(f => ({ ...f, onlyOnline: checked })); }
  onQueryChange(q: string) { this.filters.update(f => ({ ...f, q })); }
}
