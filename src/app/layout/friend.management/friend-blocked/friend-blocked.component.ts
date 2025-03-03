//src\app\layout\friend.management\friend-blocked\friend-blocked.component.ts
import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store, select } from '@ngrx/store';
import { Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AppState } from 'src/app/store/states/app.state';
import { UserInteractionsService } from 'src/app/core/services/data-handling/user-interactions.service';
import { loadBlocked } from 'src/app/store/actions/actions.interactions/actions.friends';

@Component({
  selector: 'app-friend-blocked',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './friend-blocked.component.html',
  styleUrl: './friend-blocked.component.css'
})
export class FriendBlockedComponent implements OnInit {
  @Input() user!: IUserDados; // ⬅ Agora recebemos `user` como Input
  blockedUsers$!: Observable<IUserDados[]>;

  constructor(
    private store: Store<AppState>,
    private userInteractionsService: UserInteractionsService
  ) { }

  ngOnInit(): void {
    if (!this.user || !this.user.uid) return; // ⬅ Garante que o usuário está disponível

    this.store.dispatch(loadBlocked());
    this.blockedUsers$ = this.store.pipe(select(state => state.friends.blocked));
  }

  blockUser(friendUid: string): void {
    if (!this.user?.uid) return;
    this.userInteractionsService.blockUser(this.user.uid, friendUid).subscribe(() => {
      this.store.dispatch(loadBlocked()); // 🔄 Atualiza a lista de bloqueados
    });
  }

  unblockUser(friendUid: string): void {
    if (!this.user?.uid) return;
    this.userInteractionsService.blockUser(this.user.uid, friendUid).subscribe(() => {
      this.store.dispatch(loadBlocked()); // 🔄 Atualiza a lista após desbloqueio
    });
  }
}
