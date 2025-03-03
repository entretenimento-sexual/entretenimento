//src\app\layout\friend.management\friend-list\friend-list.component.ts
import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store, select } from '@ngrx/store';
import { Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AppState } from 'src/app/store/states/app.state';
import { UserInteractionsService } from 'src/app/core/services/data-handling/user-interactions.service';
import { loadFriends } from 'src/app/store/actions/actions.interactions/actions.friends';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-friend-list',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule],
  templateUrl: './friend-list.component.html',
  styleUrl: './friend-list.component.css'
})
export class FriendListComponent implements OnInit {
  @Input() user!: IUserDados; // 🔹 Recebemos o usuário autenticado
  friends$!: Observable<IUserDados[]>; // 🔹 Lista de amigos

  constructor(
    private store: Store<AppState>,
    private userInteractionsService: UserInteractionsService
  ) { }

  ngOnInit(): void {
    if (!this.user?.uid) return;

    // 🔥 Dispara ação para carregar amigos
    this.store.dispatch(loadFriends({ uid: this.user.uid }));

    // 🔄 Obtém a lista de amigos do estado
    this.friends$ = this.store.pipe(select(state => state.friends.friends));
  }

  removeFriend(friendUid: string): void {
    if (!this.user?.uid) return;

    // 🔥 Remove amigo e recarrega a lista
    this.userInteractionsService.blockUser(this.user.uid, friendUid).subscribe(() => {
      this.store.dispatch(loadFriends({ uid: this.user.uid }));
    });
  }
}
