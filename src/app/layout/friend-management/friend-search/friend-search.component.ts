// src/app/layout/friend-management/friend-search/friend-search.component.ts
// Busca de usuários com estado visual local e cache tipado em memória.
//
// SUPRESSÕES EXPLÍCITAS DESTA MIGRAÇÃO:
// - SUPRIMIDA a chave `loadingSearch` do CacheService.
//   Motivo: loading é estado transitório da interface, não dado reutilizável.
// - SUPRIMIDA a persistência automática de `search:*` no IndexedDB.
//   Motivo: consultas e resultados sociais são privados e devem permanecer
//   somente em memória durante a sessão.
import {
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  BehaviorSubject,
  Observable,
  of,
} from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
  switchMap,
  take,
} from 'rxjs/operators';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { AppCacheService } from 'src/app/core/services/general/cache/app-cache.service';
import { CacheDefinition } from 'src/app/core/services/general/cache/cache-contracts';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';

import { Store } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { loadSearchResultsSuccess } from 'src/app/store/actions/actions.interactions/actions.friends';
import {
  selectFriendSearchResults,
  selectHasFriendSearchResults,
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
    MatListModule,
  ],
  templateUrl: './friend-search.component.html',
  styleUrls: ['./friend-search.component.css'],
})
export class FriendSearchComponent implements OnInit {
  private readonly friendship = inject(FriendshipService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly cache = inject(AppCacheService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly destroyRef = inject(DestroyRef);

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);

  readonly searchControl = new FormControl<string>('', {
    nonNullable: true,
  });

  readonly isLoading$: Observable<boolean> =
    this.loadingSubject.asObservable().pipe(distinctUntilChanged());

  readonly searchResults$: Observable<IUserDados[]> =
    this.store.select(selectFriendSearchResults);

  readonly hasResults$ = this.store.select(
    selectHasFriendSearchResults
  );

  ngOnInit(): void {
    this.searchControl.valueChanges
      .pipe(
        map((term) => this.normalizeSearchTerm(term)),
        debounceTime(500),
        distinctUntilChanged(),
        switchMap((term) => {
          if (!term) {
            this.loadingSubject.next(false);
            this.store.dispatch(
              loadSearchResultsSuccess({ results: [] })
            );
            return of(void 0);
          }

          return this.searchFriends(term);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  /** Busca, atualiza o Store e mantém cache privado somente em memória. */
  private searchFriends(searchTerm: string): Observable<void> {
    const definition = this.searchCacheDefinition(searchTerm);
    this.loadingSubject.next(true);

    return this.cache.get$(definition).pipe(
      switchMap((cached) => {
        if (cached.status !== 'miss') {
          this.store.dispatch(
            loadSearchResultsSuccess({ results: cached.value })
          );
          return of(void 0);
        }

        return this.friendship.searchUsers(searchTerm).pipe(
          switchMap((results) =>
            this.cache.set$(definition, results).pipe(
              map(() => {
                this.store.dispatch(
                  loadSearchResultsSuccess({ results })
                );
                return void 0;
              })
            )
          )
        );
      }),
      take(1),
      catchError((error) => {
        this.reportSearchError(error);
        return of(void 0);
      }),
      finalize(() => this.loadingSubject.next(false))
    );
  }

  private searchCacheDefinition(
    searchTerm: string
  ): CacheDefinition<IUserDados[]> {
    const ownerUid =
      this.currentUserStore.getLoggedUserUIDSnapshot();

    const base = {
      key: `friend-search:${searchTerm}`,
      sensitivity: 'private' as const,
      storage: 'memory' as const,
      ttlMs: 5 * 60 * 1000,
      version: 1,
      validate: (value: unknown): value is IUserDados[] =>
        Array.isArray(value) &&
        value.every(
          (item) =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as { uid?: unknown }).uid === 'string'
        ),
    };

    return ownerUid
      ? {
          ...base,
          scope: 'user',
          ownerUid,
        }
      : {
          ...base,
          scope: 'session',
        };
  }

  private normalizeSearchTerm(value: string): string {
    return String(value ?? '')
      .trim()
      .toLocaleLowerCase('pt-BR');
  }

  private reportSearchError(error: unknown): void {
    try {
      const wrapped =
        error instanceof Error
          ? error
          : new Error('[FriendSearchComponent] search failed');

      (wrapped as any).original = error;
      (wrapped as any).feature = 'friend-search';
      (wrapped as any).context = { operation: 'searchFriends' };
      (wrapped as any).silent = true;
      (wrapped as any).skipUserNotification = true;

      this.globalError.handleError(wrapped);
    } catch {
      // O feedback visual abaixo continua disponível.
    }

    this.errorNotifier.showError(
      'Não foi possível buscar usuários agora. Tente novamente.'
    );
  }
}
