// src/app/layout/friend-management/friend-blocked/friend-blocked.component.ts
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, filter, take } from 'rxjs';
import { AppState } from 'src/app/store/states/app.state';
import { BlockedUserActive } from 'src/app/core/interfaces/friendship/blocked-user.interface';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { loadBlockedUsers } from 'src/app/store/actions/actions.interactions/actions.friends';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { PageHeaderComponent } from 'src/app/shared/page-header/page-header.component';
import { ContentStateComponent } from 'src/app/shared/content-state/content-state.component';

// ✅ selectors tipados
import {
  selectBlockedFriends
} from 'src/app/store/selectors/selectors.interactions/friends/blocked.selectors';

@Component({
  selector: 'app-friend-blocked',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, ContentStateComponent],
  templateUrl: './friend-blocked.component.html',
  styleUrls: ['./friend-blocked.component.css']
})
export class FriendBlockedComponent implements OnInit {
  readonly uid = signal<string | null>(null);
  blockedUsers$!: Observable<BlockedUserActive[]>;

  private store = inject<Store<AppState>>(Store as any);
  private friendship = inject(FriendshipService);
  private authSession = inject(AuthSessionService);

  ngOnInit(): void {
    this.blockedUsers$ = this.store.select(selectBlockedFriends);

    this.authSession.readyUid$
      .pipe(
        filter((uid): uid is string => typeof uid === 'string' && uid.trim().length > 0),
        take(1)
      )
      .subscribe((uid) => {
        const normalizedUid = uid.trim();
        this.uid.set(normalizedUid);
        this.store.dispatch(loadBlockedUsers({ uid: normalizedUid }));
      });
  }

  blockUser(friendUid: string): void {
    const uid = this.uid();
    if (!uid) return;

    this.friendship.blockUser(uid, friendUid).subscribe(() => {
      this.store.dispatch(loadBlockedUsers({ uid }));
    });
  }

  unblockUser(friendUid: string): void {
    const uid = this.uid();
    if (!uid) return;

    this.friendship.unblockUser(uid, friendUid).subscribe(() => {
      this.store.dispatch(loadBlockedUsers({ uid }));
    });
  }
}
