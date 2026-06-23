import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, combineLatest, Observable, of } from 'rxjs';
import { distinctUntilChanged, finalize, map, shareReplay, switchMap, take } from 'rxjs/operators';
import { ExploreSectionComponent } from '../../components/explore-section/explore-section.component';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { PublicPhotoCardComponent } from 'src/app/media/shared/components/public-photo-card/public-photo-card.component';
import { PublicPhotoLightboxComponent } from 'src/app/media/shared/components/public-photo-lightbox/public-photo-lightbox.component';
import { ExploreFeedFacade } from '../../facades/explore-feed.facade';
import { IExploreFeedVm } from '../../services/explore-feed.service';
import { TExploreSectionId } from '../../models/i-explore-section';
import { PhotoViewTrackingService } from 'src/app/core/services/media/photo-view-tracking.service';
import { PublicProfilesListComponent } from 'src/app/dashboard/discovery/public-profiles-list/public-profiles-list.component';
import { UserIntentStatusRadarComponent } from 'src/app/dashboard/user-intent-status/user-intent-status-radar/user-intent-status-radar.component';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { IUserIntentStatusCardVm } from 'src/app/core/interfaces/discovery/user-intent-status.interface';
import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

type TExplorePhotoSection = Extract<
  TExploreSectionId,
  'boosted' | 'mostViewed' | 'top' | 'latest'
>;

interface IExploreLightboxState {
  readonly section: TExplorePhotoSection;
  readonly index: number;
}

@Component({
  selector: 'app-social-explore-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PublicPhotoCardComponent,
    PublicPhotoLightboxComponent,
    ExploreSectionComponent,
    PublicProfilesListComponent,
    UserIntentStatusRadarComponent,
  ],
  templateUrl: './social-explore-page.component.html',
  styleUrls: ['./social-explore-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SocialExplorePageComponent {
  private readonly exploreFeedFacade = inject(ExploreFeedFacade);
  private readonly photoViewTracking = inject(PhotoViewTrackingService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly authSession = inject(AuthSessionService);
  private readonly statusService = inject(UserIntentStatusService);
  private readonly notifications = inject(ErrorNotificationService);

  private readonly lightboxStateSubject = new BehaviorSubject<IExploreLightboxState | null>(null);

  hidingMyStatus = false;

  readonly vm$: Observable<IExploreFeedVm> = this.exploreFeedFacade.vm$;
  readonly currentUser$: Observable<IUserDados | null> = this.currentUserStore.user$.pipe(
    map((user) => user ?? null),
    shareReplay({ bufferSize: 1, refCount: true })
  );
  readonly authUid$: Observable<string> = this.authSession.uid$.pipe(
    map((uid) => String(uid ?? '').trim()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );
  readonly myActiveStatus$: Observable<IUserIntentStatusCardVm | null> = this.authUid$.pipe(
    switchMap((uid) => uid
      ? this.statusService.watchCurrentStatus$(uid)
      : of(null)
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );
  readonly lightboxState$ = this.lightboxStateSubject.asObservable();

  readonly activeLightboxItems$: Observable<readonly IPublicPhotoItem[]> = combineLatest([
    this.lightboxState$,
    this.vm$,
  ]).pipe(
    map(([state, vm]) => {
      if (!state) {
        return [];
      }

      switch (state.section) {
        case 'boosted':
          return vm.boostedPhotos;

        case 'mostViewed':
          return vm.mostViewedPhotos;

        case 'top':
          return vm.topPhotos;

        case 'latest':
          return vm.latestPhotos;

        default:
          return [];
      }
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  openPhoto(section: TExplorePhotoSection, index: number): void {
    this.lightboxStateSubject.next({ section, index });

    this.activeLightboxItems$
      .pipe(take(1))
      .subscribe((items) => {
        const item = items[index];

        if (!item) {
          return;
        }

        this.photoViewTracking
          .recordPhotoView$(item.ownerUid, item.id, this.resolveViewSource(section))
          .pipe(take(1))
          .subscribe();
      });
  }

  hideMyStatus(_user: IUserDados | null): void {
    if (this.hidingMyStatus) {
      return;
    }

    this.authUid$.pipe(take(1)).subscribe((uid) => {
      if (!uid) {
        this.notifications.showWarning('Entre novamente para encerrar seu status.');
        return;
      }

      this.hidingMyStatus = true;

      this.statusService.hideCurrentStatus$(uid).pipe(
        take(1),
        finalize(() => {
          this.hidingMyStatus = false;
        })
      ).subscribe({
        next: () => this.notifications.showSuccess('Status encerrado.'),
        error: () => this.notifications.showError('Não foi possível encerrar seu status agora.'),
      });
    });
  }

  closeViewer(): void {
    this.lightboxStateSubject.next(null);
  }

  prev(): void {
    const state = this.lightboxStateSubject.value;

    if (!state || state.index <= 0) {
      return;
    }

    this.lightboxStateSubject.next({
      ...state,
      index: state.index - 1,
    });
  }

  next(): void {
    const state = this.lightboxStateSubject.value;

    if (!state) {
      return;
    }

    this.activeLightboxItems$
      .pipe(take(1))
      .subscribe((items) => {
        if (state.index >= items.length - 1) {
          return;
        }

        this.lightboxStateSubject.next({
          ...state,
          index: state.index + 1,
        });
      });
  }

  trackByPhotoId(_index: number, item: IPublicPhotoItem): string {
    return item.id;
  }

  private resolveViewSource(section: TExplorePhotoSection) {
    switch (section) {
      case 'boosted':
        return 'boosted';

      case 'top':
        return 'top';

      case 'latest':
        return 'latest';

      case 'mostViewed':
        return 'discover';

      default:
        return 'unknown';
    }
  }
}
