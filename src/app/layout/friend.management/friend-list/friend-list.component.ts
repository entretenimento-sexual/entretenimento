//src\app\layout\friend.management\friend-list\friend-list.component.ts
import { Component, OnInit, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store, select } from '@ngrx/store';
import { Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AppState } from 'src/app/store/states/app.state';
import { UserInteractionsService } from 'src/app/core/services/data-handling/user-interactions.service';
import { loadFriends } from 'src/app/store/actions/actions.interactions/actions.friends';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { IFriend } from 'src/app/core/interfaces/friendship/ifriend';

@Component({
  selector: 'app-friend-list',
  templateUrl: './friend-list.component.html',
  styleUrl: './friend-list.component.css',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule],
})

export class FriendListComponent implements OnInit {
  readonly user = input.required<IUserDados>(); // 🔹 Recebemos o usuário autenticado
  readonly limit = input<number>();
  friends$!: Observable<IFriend[]>;

  constructor(private store: Store<AppState>,
              private userInteractionsService: UserInteractionsService,) { }

  ngOnInit(): void {
    
    const user = this.user();
    if (!user?.uid) return;

    // 🔥 Dispara ação para carregar amigos
    this.store.dispatch(loadFriends({ uid: user.uid }));

    // 🔄 Obtém a lista de amigos do estado
    this.friends$ = this.store.pipe(select(state => state.friends.friends));
  }

  getLimitedFriends(friends: IUserDados[]): IUserDados[] {

    const limit = this.limit();
    return limit ? friends.slice(0, limit) : friends;
  }

  removeFriend(friendUid: string): void {

    const user = this.user();
    if (!user?.uid) return;

    // 🔥 Remove amigo e recarrega a lista
    this.userInteractionsService.blockUser(user.uid, friendUid).subscribe(() => {
      this.store.dispatch(loadFriends({ uid: this.user().uid }));
    });
  }
}
