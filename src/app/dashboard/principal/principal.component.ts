// src/app/dashboard/principal/principal.component.ts
import { Component, OnInit } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AppState } from 'src/app/store/states/app.state';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';
import { filter, take } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FriendListComponent } from 'src/app/layout/friend.management/friend-list/friend-list.component';
import { OnlineUsersComponent } from '../online-users/online-users.component';
import { loadRequests } from 'src/app/store/actions/actions.interactions/actions.friends';
import { selectPendingFriendRequestsCount } from 'src/app/store/selectors/selectors.interactions/friend.selector';

@Component({
    selector: 'app-principal',
    templateUrl: './principal.component.html',
    styleUrls: ['./principal.component.css'],
    standalone: true,
    imports: [CommonModule, MatProgressSpinnerModule, FriendListComponent,
              OnlineUsersComponent],

})
export class PrincipalComponent implements OnInit {
  currentUser$: Observable<IUserDados | null>;
  pendingRequestsCount$: Observable<number>;

  constructor(private store: Store<AppState>) {
              this.currentUser$ = this.store.select(selectCurrentUser);
              this.pendingRequestsCount$ = this.store.select(selectPendingFriendRequestsCount);
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
        this.store.dispatch(loadRequests());
      }

      // 🔥 Adicionando um log para verificar se a contagem de solicitações está correta
      this.pendingRequestsCount$.subscribe(count => {
        console.log('🔢 Contagem de solicitações pendentes no store:', count);
      });
    });
}
}
