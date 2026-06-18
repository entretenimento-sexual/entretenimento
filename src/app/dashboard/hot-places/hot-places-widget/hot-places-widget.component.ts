// src/app/dashboard/hot-places/hot-places-widget/hot-places-widget.component.ts
// -----------------------------------------------------------------------------
// HOT PLACES WIDGET
// -----------------------------------------------------------------------------
// Widget inicial para exibir "Locais bombando" no dashboard.
//
// Direção:
// - standalone e lazy-friendly;
// - reativo por Observable;
// - mobile-first;
// - não expõe dados sensíveis;
// - não cria fallback amplo quando não há região do usuário;
// - aceita coleção vazia sem quebrar a experiência.

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable, of } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import { IHotPlaceCardVm } from 'src/app/core/interfaces/places/hot-place.interface';
import { HotPlacesService } from 'src/app/core/services/places/hot-places.service';
import { AppState } from 'src/app/store/states/app.state';
import { selectCurrentUserUid } from 'src/app/store/selectors/selectors.user/user.selectors';

type HotPlacesWidgetState = 'loading' | 'ready' | 'empty';

interface HotPlacesWidgetVm {
  state: HotPlacesWidgetState;
  items: IHotPlaceCardVm[];
}

@Component({
  selector: 'app-hot-places-widget',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './hot-places-widget.component.html',
  styleUrls: ['./hot-places-widget.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HotPlacesWidgetComponent {
  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly hotPlaces = inject(HotPlacesService);

  private readonly uid$: Observable<string | null> = this.store
    .select(selectCurrentUserUid)
    .pipe(
      map((uid) => uid?.trim() || null),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly vm$: Observable<HotPlacesWidgetVm> = this.uid$.pipe(
    switchMap((uid) => {
      if (!uid) {
        return of<HotPlacesWidgetVm>({ state: 'empty', items: [] });
      }

      return this.hotPlaces.watchHotPlacesForUserRegion$(uid, {
        limit: 6,
        minimumScore: 1,
        audience: 'any',
      }).pipe(
        map((items) => ({
          state: items.length > 0 ? 'ready' : 'empty',
          items,
        }) satisfies HotPlacesWidgetVm),
        startWith({ state: 'loading', items: [] } satisfies HotPlacesWidgetVm)
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  trackByPlaceId(_index: number, item: IHotPlaceCardVm): string {
    return item.id;
  }
}
