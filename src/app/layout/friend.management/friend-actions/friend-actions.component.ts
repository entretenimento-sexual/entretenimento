//src\app\layout\friend.management\friend-actions\friend-actions.component.ts
import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store, select } from '@ngrx/store';
import { Observable, of } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AppState } from 'src/app/store/states/app.state';
import { UserInteractionsService } from 'src/app/core/services/data-handling/user-interactions.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { loadFriends, loadRequests, sendFriendRequest } from 'src/app/store/actions/actions.interactions/actions.friends';
import { FriendBlockedComponent } from '../friend-blocked/friend-blocked.component'; // ⬅ Importando o componente de bloqueio
import { FriendListComponent } from '../friend-list/friend-list.component';
import { FriendRequestsComponent } from '../friend-requests/friend-requests.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-friend-actions',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, FriendBlockedComponent,
      FriendListComponent, FriendRequestsComponent, MatFormFieldModule, MatInputModule,],
  templateUrl: './friend-actions.component.html',
  styleUrl: './friend-actions.component.css'
})

export class FriendActionsComponent implements OnInit {
  @Input() user!: IUserDados;
  friendRequests$!: Observable<IUserDados[]>;
  isLoading$: Observable<boolean> = of(false);

  constructor(
    private store: Store<AppState>,
    private userInteractionsService: UserInteractionsService
  ) { }

  ngOnInit(): void {
    if (!this.user || !this.user.uid) return;

    this.store.dispatch(loadFriends({ uid: this.user.uid }));
    this.store.dispatch(loadRequests()); // 🔄 Removemos `loadBlocked()`, pois é responsabilidade do outro componente

    this.friendRequests$ = this.store.pipe(select(state => state.friends.requests));
  }

  sendFriendRequest(friendUid: string, message: string = ''): void {
    if (!this.user?.uid || !friendUid) return;

    this.store.dispatch(sendFriendRequest({ userUid: this.user.uid, friendUid, message }));

    this.userInteractionsService.sendFriendRequest(this.user.uid, friendUid, message).subscribe(() => {
      console.log('Solicitação enviada com sucesso!');
    });
  }
}
