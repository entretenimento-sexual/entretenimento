// src/app/layout/friend.management/friend-blocked/friend-blocked.component.ts
import { Component, OnInit, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { AppState } from 'src/app/store/states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { BlockedUserActive } from 'src/app/core/interfaces/friendship/blocked-user.interface';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { loadBlockedUsers } from 'src/app/store/actions/actions.interactions/actions.friends';

// ✅ selectors tipados
import {
  selectBlockedFriends
} from 'src/app/store/selectors/selectors.interactions/friends/blocked.selectors';

@Component({
  selector: 'app-friend-blocked',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './friend-blocked.component.html',
  styleUrls: ['./friend-blocked.component.css']
})
export class FriendBlockedComponent implements OnInit {
  readonly user = input.required<IUserDados>();
  blockedUsers$!: Observable<BlockedUserActive[]>;

  private store = inject<Store<AppState>>(Store as any);
  private friendship = inject(FriendshipService);

  ngOnInit(): void {
    const u = this.user();
    if (!u?.uid) return;

    this.store.dispatch(loadBlockedUsers({ uid: u.uid }));
    this.blockedUsers$ = this.store.select(selectBlockedFriends);
  }

  blockUser(friendUid: string) {
    const u = this.user();
    if (!u?.uid) return;
    this.friendship.blockUser(u.uid, friendUid).subscribe(() => {
      this.store.dispatch(loadBlockedUsers({ uid: u.uid }));
    });
  }

  unblockUser(friendUid: string) {
    const u = this.user();
    if (!u?.uid) return;
    this.friendship.unblockUser(u.uid, friendUid).subscribe(() => {
      this.store.dispatch(loadBlockedUsers({ uid: u.uid }));
    });
  }
}
