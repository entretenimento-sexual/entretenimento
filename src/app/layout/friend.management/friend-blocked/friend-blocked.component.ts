// src/app/layout/friend.management/friend-blocked/friend-blocked.component.ts
import { Component, OnInit, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store, select } from '@ngrx/store';
import { Observable } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AppState } from 'src/app/store/states/app.state';

// ✅ novas ações unificadas de amizade
import {
  loadBlockedUsers,
  // se você decidir usar NgRx pra bloquear/desbloquear via effects:
  // blockUser,
  // unblockUser,
} from '../../../store/actions/actions.interactions/actions.friends';

import { BlockedUserActive } from 'src/app/core/interfaces/friendship/blocked-user.interface';

// ✅ novo serviço unificado
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';

@Component({
  selector: 'app-friend-blocked',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './friend-blocked.component.html',
  styleUrl: './friend-blocked.component.css'
})
export class FriendBlockedComponent implements OnInit {
  readonly user = input.required<IUserDados>();
  blockedUsers$!: Observable<BlockedUserActive[]>;

  constructor(
    private store: Store<AppState>,
    private friendship: FriendshipService, // ⬅️ trocou o serviço
  ) { }

  ngOnInit(): void {
    const u = this.user();
    if (!u?.uid) return;

    // ⬅️ nova action
    this.store.dispatch(loadBlockedUsers({ uid: u.uid }));

    // você pode manter esse select direto enquanto não cria selectors dedicados
    this.blockedUsers$ = this.store.pipe(select(s => s.interactions_friends.blocked));
  }

  blockUser(friendUid: string): void {
    const u = this.user();
    if (!u?.uid) return;

    // Se ainda não tiver Effects pra isso, usa o serviço e depois refaz o load:
    this.friendship.blockUser(u.uid, friendUid).subscribe(() => {
      this.store.dispatch(loadBlockedUsers({ uid: u.uid }));
    });

    // Quando tiver Effects prontos:
    // this.store.dispatch(blockUser({ ownerUid: u.uid, targetUid: friendUid }));
  }

  unblockUser(friendUid: string): void {
    const u = this.user();
    if (!u?.uid) return;

    // Corrigido: chamar o método certo
    this.friendship.unblockUser(u.uid, friendUid).subscribe(() => {
      this.store.dispatch(loadBlockedUsers({ uid: u.uid }));
    });

    // Quando tiver Effects prontos:
    // this.store.dispatch(unblockUser({ ownerUid: u.uid, targetUid: friendUid }));
  }
}
