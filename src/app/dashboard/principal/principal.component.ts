// src/app/dashboard/principal/principal.component.ts
import { Component, OnInit, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AppState } from 'src/app/store/states/app.state';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';
import { filter, map, take } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FriendListComponent } from 'src/app/layout/friend.management/friend-list/friend-list.component';
import { loadInboundRequests } from 'src/app/store/actions/actions.interactions/actions.friends';
import { selectFriendsCount, selectPendingFriendRequestsCount } from 'src/app/store/selectors/selectors.interactions/friend.selector';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterModule } from '@angular/router';
import { MatOptionModule } from '@angular/material/core';
import { OnlineUsersComponent } from '../online/online-users/online-users.component';

@Component({
    selector: 'app-principal',
    templateUrl: './principal.component.html',
    styleUrls: ['./principal.component.css'],
    standalone: true,
    imports: [CommonModule, MatProgressSpinnerModule, FriendListComponent,
              OnlineUsersComponent, MatSlideToggleModule, MatOptionModule,
              MatSelectModule, RouterModule],
})

export class PrincipalComponent implements OnInit {
  currentUser$: Observable<IUserDados | null>;
  pendingRequestsCount$: Observable<number>;
  showSeeAll$: Observable<boolean>;
  // ✅ NOVO: estado de UI local (Signals)
  readonly expanded = signal<boolean>(false);
  readonly sortBy = signal<'recent' | 'online' | 'distance' | 'alpha'>('online');
  readonly filters = signal<{ onlyOnline?: boolean }>({ onlyOnline: true });


  constructor(private store: Store<AppState>) {
    this.currentUser$ = this.store.select(selectCurrentUser);
    this.pendingRequestsCount$ = this.store.select(selectPendingFriendRequestsCount);
    this.showSeeAll$ = this.store.select(selectFriendsCount).pipe(map(c => c > 6));
            }

  ngOnInit(): void {
    // Espera até que o currentUser seja emitido
    this.currentUser$.pipe(
      filter(user => !!user && !!user.uid),
      take(1)
    ).subscribe(user => {
      console.log('Usuário disponível no componente:', user);
      // 🔥 Carregar as solicitações pendentes quando o usuário fizer login
      if (user) {
        this.store.dispatch(loadInboundRequests({ uid: user.uid }));
      }

      // 🔥 Adicionando um log para verificar se a contagem de solicitações está correta
      this.pendingRequestsCount$.subscribe(count => {
        console.log('🔢 Contagem de solicitações pendentes no store:', count);
      });
    });
  }

  // ✅ NOVO: handlers do toolbar
  toggleExpand(): void {
    this.expanded.update(v => !v);
  }

  onSortChange(value: 'recent' | 'online' | 'distance' | 'alpha'): void {
    this.sortBy.set(value);
  }

  onOnlyOnlineToggle(checked: boolean): void {
    this.filters.set({ ...this.filters(), onlyOnline: checked });
  }
}
