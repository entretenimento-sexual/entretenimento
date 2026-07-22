// src/app/dashboard/principal/principal.component.ts
// -----------------------------------------------------------------------------
// Feed principal da plataforma.
// - Mantém uma coluna central contínua e mobile-first.
// - Usa somente dados reais já hidratados no NgRx.
// - Reaproveita status, conexões e descoberta sem criar conteúdo artificial.
// - Mantém UID como fonte única para carregamentos e navegação do usuário.
// -----------------------------------------------------------------------------
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';

import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import {
  IProfileChecklistItemVm,
  IProfileChecklistVm,
  ProfileCompletionService,
} from 'src/app/core/services/user-profile/profile-completion.service';
import { PAGE_SIZES } from 'src/app/shared/pagination/page.constants';
import * as P from 'src/app/store/actions/actions.interactions/friends/friends-pagination.actions';
import {
  selectFriendsCount,
  selectInboundRequestsCount,
} from 'src/app/store/selectors/selectors.interactions/friend.selector';
import {
  selectFriendsPageItems,
  selectFriendsPageLoading,
} from 'src/app/store/selectors/selectors.interactions/friends/pagination.selectors';
import {
  selectCurrentUser,
  selectCurrentUserStatus,
  selectCurrentUserUid,
} from 'src/app/store/selectors/selectors.user/user.selectors';
import { AppState } from 'src/app/store/states/app.state';
import { HotPlacesWidgetComponent } from '../hot-places/hot-places-widget/hot-places-widget.component';
import { UserIntentStatusComposerComponent } from '../user-intent-status/user-intent-status-composer/user-intent-status-composer.component';
import { UserIntentStatusRadarComponent } from '../user-intent-status/user-intent-status-radar/user-intent-status-radar.component';

interface IPrincipalChecklistVm extends IProfileChecklistVm {
  readonly pendingItems: IProfileChecklistItemVm[];
  readonly firstPending: IProfileChecklistItemVm | null;
}

@Component({
  selector: 'app-principal',
  templateUrl: './principal.component.html',
  styleUrls: ['./principal.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    HotPlacesWidgetComponent,
    UserIntentStatusComposerComponent,
    UserIntentStatusRadarComponent,
  ],
})
export class PrincipalComponent implements OnInit {
  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly profileCompletion = inject(ProfileCompletionService);

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('friends', `Principal: ${message}`, extra);
  }

  readonly currentUser$: Observable<IUserDados | null> = this.store.select(selectCurrentUser);
  readonly currentUserStatus$ = this.store.select(selectCurrentUserStatus);

  readonly profileChecklist$: Observable<IPrincipalChecklistVm | null> = this.currentUser$.pipe(
    map((user) => user ? this.buildPrincipalChecklistVm(user) : null),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Fonte única de verdade para ações relacionadas à conta atual. */
  private readonly uid$ = this.store.select(selectCurrentUserUid).pipe(
    map((uid) => uid?.trim() || null),
    distinctUntilChanged(),
    tap((uid) => this.dbg('authUid$', { hasUid: !!uid })),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly profileLink$: Observable<any[] | null> = this.uid$.pipe(
    map((uid) => uid ? ['/perfil', uid] : null),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly preferencesLink$: Observable<any[] | null> = this.uid$.pipe(
    map((uid) => uid ? ['/preferencias', 'editar', uid] : null),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly pendingRequestsCount$: Observable<number> = this.store.select(selectInboundRequestsCount);
  readonly friendsCount$: Observable<number> = this.store.select(selectFriendsCount);

  readonly items$: Observable<any[]> = this.uid$.pipe(
    filter((uid): uid is string => !!uid),
    switchMap((uid) => this.store.select(selectFriendsPageItems(uid)))
  );

  readonly loading$: Observable<boolean> = this.uid$.pipe(
    filter((uid): uid is string => !!uid),
    switchMap((uid) => this.store.select(selectFriendsPageLoading(uid)))
  );

  readonly expanded = signal(false);
  readonly checklistDetailsOpen = signal(false);

  ngOnInit(): void {
    this.uid$
      .pipe(
        filter((uid): uid is string => !!uid),
        take(1)
      )
      .subscribe((uid) => {
        this.dbg('dispatch loadFriendsFirstPage', {
          hasUid: true,
          pageSize: PAGE_SIZES.FRIENDS_DASHBOARD,
        });

        this.store.dispatch(P.loadFriendsFirstPage({
          uid,
          pageSize: PAGE_SIZES.FRIENDS_DASHBOARD,
        }));
      });
  }

  toggleExpand(): void {
    this.expanded.update((value) => !value);
  }

  toggleChecklistDetails(): void {
    this.checklistDetailsOpen.update((value) => !value);
  }

  friendUid(friend: unknown): string {
    const source = friend as any;
    return String(source?.uid ?? source?.friendUid ?? source?.id ?? '').trim();
  }

  friendName(friend: unknown): string {
    const source = friend as any;
    return String(
      source?.nickname ?? source?.name ?? source?.displayName ?? 'Perfil'
    ).trim() || 'Perfil';
  }

  friendPhoto(friend: unknown): string {
    const source = friend as any;
    return String(
      source?.photoURL ?? source?.avatarUrl ?? source?.photoUrl ?? ''
    ).trim();
  }

  friendOnline(friend: unknown): boolean {
    const source = friend as any;
    return source?.isOnline === true || source?.online === true;
  }

  friendInitial(friend: unknown): string {
    return this.friendName(friend).slice(0, 1).toUpperCase() || '?';
  }

  trackFriend = (index: number, friend: unknown): string =>
    this.friendUid(friend) || `friend-${index}`;

  private buildPrincipalChecklistVm(user: IUserDados): IPrincipalChecklistVm {
    const checklist = this.profileCompletion.buildChecklist(user);
    const pendingItems = checklist.items.filter((item) => !item.completed);

    return {
      ...checklist,
      pendingItems,
      firstPending: pendingItems[0] ?? null,
    };
  }
}
