//src\app\explore\pages\social-explore-page\social-explore-page.component.ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, combineLatest, Observable } from 'rxjs';
import { map, shareReplay, take } from 'rxjs/operators';
import { ExploreSectionComponent } from '../../components/explore-section/explore-section.component';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { PublicPhotoCardComponent } from 'src/app/media/shared/components/public-photo-card/public-photo-card.component';
import { PublicPhotoLightboxComponent } from 'src/app/media/shared/components/public-photo-lightbox/public-photo-lightbox.component';
import { ExploreFeedFacade } from '../../facades/explore-feed.facade';
import { IExploreFeedVm } from '../../services/explore-feed.service';
import { TExploreSectionId } from '../../models/i-explore-section';

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
  ],
  templateUrl: './social-explore-page.component.html',
  styleUrls: ['./social-explore-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SocialExplorePageComponent {
  private readonly exploreFeedFacade = inject(ExploreFeedFacade);

  private readonly lightboxStateSubject = new BehaviorSubject<IExploreLightboxState | null>(null);

  readonly vm$: Observable<IExploreFeedVm> = this.exploreFeedFacade.vm$;
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
}
