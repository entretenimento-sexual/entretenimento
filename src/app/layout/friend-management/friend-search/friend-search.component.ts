// src/app/layout/friend-management/friend-search/friend-search.component.ts
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, switchMap, catchError, of, Observable, map } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';

import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { loadSearchResultsSuccess } from 'src/app/store/actions/actions.interactions/actions.friends';

// ✅ use os selectors que você criou
import {
  selectFriendSearchResults,
  selectHasFriendSearchResults
} from 'src/app/store/selectors/selectors.interactions/friends/search.selectors';

@Component({
  selector: 'app-friend-search',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatProgressSpinnerModule,
    MatInputModule,
    MatButtonModule,
    MatListModule
  ],
  templateUrl: './friend-search.component.html',
  styleUrls: ['./friend-search.component.css']
})
export class FriendSearchComponent implements OnInit {
  private friendship = inject(FriendshipService);
  private errorNotifier = inject(ErrorNotificationService);
  private cacheService = inject(CacheService);
  private store = inject<Store<AppState>>(Store as any);

  searchControl = new FormControl<string>('', { nonNullable: true });

  // você pode manter o loading pelo cache por enquanto
  isLoading$: Observable<boolean> = this.cacheService
    .get<boolean>('loadingSearch')
    .pipe(map(value => value ?? false));

  // 🔁 agora pelo selector (nada de s => s.interactions_friends.xxx)
  searchResults$: Observable<IUserDados[]> = this.store.select(selectFriendSearchResults);
  hasResults$ = this.store.select(selectHasFriendSearchResults);

  ngOnInit(): void {
    this.searchControl.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      switchMap(term => this.searchFriends(term ?? ''))
    ).subscribe();
  }

  /** Busca e grava no Store (com cache de 5 min). */
  private searchFriends(searchTerm: string): Observable<void> {
    if (!searchTerm.trim()) return of();

    const cacheKey = `search:${searchTerm}`;
    this.updateLoadingState(true);

    return this.cacheService.get<IUserDados[]>(cacheKey).pipe(
      switchMap(cached => {
        if (cached) {
          this.updateLoadingState(false);
          this.store.dispatch(loadSearchResultsSuccess({ results: cached }));
          return of();
        }

        return this.friendship.searchUsers(searchTerm).pipe(
          switchMap(results => {
            this.cacheService.set(cacheKey, results, 300_000); // 5 min
            this.store.dispatch(loadSearchResultsSuccess({ results }));
            this.updateLoadingState(false);
            return of();
          })
        );
      }),
      catchError(err => {
        this.updateLoadingState(false);
        this.errorNotifier.showError('Erro ao buscar usuários.', err?.message ?? 'Erro desconhecido');
        return of();
      })
    );
  }

  private updateLoadingState(state: boolean): void {
    this.cacheService.set('loadingSearch', state, 5000);
  }
}
