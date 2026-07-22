// src/app/dashboard/principal/principal.component.ts
// -----------------------------------------------------------------------------
// Fluxo principal da plataforma.
// - Não exibe título visual para anunciar que a tela é um feed.
// - Mantém ações de publicação no topo e conteúdo real em sequência.
// - Agrega perfis/casais, Comunidades e Locais por contrato canônico.
// - Mantém UID como fonte única para rotas e carregamentos privados.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import {
  Component,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
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

import { isFeatureEnabled } from 'src/app/core/guards/access-guard/feature-flag.guard';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import {
  IProfileChecklistItemVm,
  IProfileChecklistVm,
  ProfileCompletionService,
} from 'src/app/core/services/user-profile/profile-completion.service';
import { PublicPhotoCardComponent } from 'src/app/media/shared/components/public-photo-card/public-photo-card.component';
import { PublicPhotoLightboxComponent } from 'src/app/media/shared/components/public-photo-lightbox/public-photo-lightbox.component';
import { PAGE_SIZES } from 'src/app/shared/pagination/page.constants';
import * as P from 'src/app/store/actions/actions.interactions/friends/friends-pagination.actions';
import {
  selectFriendsPageItems,
  selectFriendsPageLoading,
} from 'src/app/store/selectors/selectors.interactions/friends/pagination.selectors';
import {
  selectCurrentUser,
  selectCurrentUserUid,
} from 'src/app/store/selectors/selectors.user/user.selectors';
import { AppState } from 'src/app/store/states/app.state';
import { HotPlacesWidgetComponent } from '../hot-places/hot-places-widget/hot-places-widget.component';
import { UserIntentStatusComposerComponent } from '../user-intent-status/user-intent-status-composer/user-intent-status-composer.component';
import { UserIntentStatusRadarComponent } from '../user-intent-status/user-intent-status-radar/user-intent-status-radar.component';
import {
  PrincipalFeedItem,
  PrincipalFeedState,
} from './principal-feed.model';
import { PrincipalFeedService } from './principal-feed.service';

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
    UserIntentStatusComposerComponent,
    UserIntentStatusRadarComponent,
    HotPlacesWidgetComponent,
    PublicPhotoCardComponent,
    PublicPhotoLightboxComponent,
  ],
})
export class PrincipalComponent implements OnInit {
  @ViewChild(UserIntentStatusComposerComponent)
  private statusComposer?: UserIntentStatusComposerComponent;

  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly profileCompletion = inject(ProfileCompletionService);
  private readonly principalFeed = inject(PrincipalFeedService);

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('friends', `Principal: ${message}`, extra);
  }

  readonly socialSpacesEnabled = isFeatureEnabled('communityPreview');

  readonly currentUser$: Observable<IUserDados | null> = this.store.select(
    selectCurrentUser
  );

  readonly profileChecklist$: Observable<IPrincipalChecklistVm | null> =
    this.currentUser$.pipe(
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

  readonly photoUploadLink$: Observable<any[] | null> = this.uid$.pipe(
    map((uid) => uid
      ? ['/media', 'perfil', uid, 'fotos', 'upload']
      : null),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly videoLibraryLink$: Observable<any[] | null> = this.uid$.pipe(
    map((uid) => uid ? ['/media', 'perfil', uid, 'videos'] : null),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly items$: Observable<any[]> = this.uid$.pipe(
    filter((uid): uid is string => !!uid),
    switchMap((uid) => this.store.select(selectFriendsPageItems(uid)))
  );

  readonly loading$: Observable<boolean> = this.uid$.pipe(
    filter((uid): uid is string => !!uid),
    switchMap((uid) => this.store.select(selectFriendsPageLoading(uid)))
  );

  readonly feedState$: Observable<PrincipalFeedState> =
    this.principalFeed.state$;

  readonly expanded = signal(false);
  readonly checklistDetailsOpen = signal(false);
  readonly statusComposerVisible = signal(false);
  readonly selectedPhotoIndex = signal<number | null>(null);
  readonly selectedPhotos = signal<readonly IPublicPhotoItem[]>([]);

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

  openStatusComposer(): void {
    this.statusComposerVisible.set(true);
    queueMicrotask(() => this.statusComposer?.openComposer());
  }

  toggleExpand(): void {
    this.expanded.update((value) => !value);
  }

  toggleChecklistDetails(): void {
    this.checklistDetailsOpen.update((value) => !value);
  }

  retryFeed(): void {
    this.principalFeed.refresh();
  }

  openPhoto(
    photoId: string,
    photos: readonly IPublicPhotoItem[]
  ): void {
    const index = photos.findIndex((photo) => photo.id === photoId);
    if (index < 0) return;

    this.selectedPhotos.set(photos);
    this.selectedPhotoIndex.set(index);
  }

  closePhoto(): void {
    this.selectedPhotoIndex.set(null);
    this.selectedPhotos.set([]);
  }

  previousPhoto(): void {
    this.selectedPhotoIndex.update((index) =>
      index !== null && index > 0 ? index - 1 : index
    );
  }

  nextPhoto(): void {
    const lastIndex = this.selectedPhotos().length - 1;
    this.selectedPhotoIndex.update((index) =>
      index !== null && index < lastIndex ? index + 1 : index
    );
  }

  feedItemRoute(item: PrincipalFeedItem): any[] {
    if (item.kind === 'profile-photo') {
      return ['/outro-perfil', item.photo.ownerUid];
    }

    return item.kind === 'venue'
      ? ['/dashboard', 'locais', item.space.communityId]
      : ['/dashboard', 'comunidades', item.space.communityId];
  }

  feedItemLabel(item: PrincipalFeedItem): string {
    if (item.kind === 'profile-photo') return 'Perfil';
    return item.kind === 'venue' ? 'Local' : 'Comunidade';
  }

  trackFeedItem = (_index: number, item: PrincipalFeedItem): string => item.id;

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
