// src/app/layout/friend-management/friend-search/friend-search.component.ts
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  BehaviorSubject,
  Observable,
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
  of,
  switchMap,
  take,
  tap,
  throwError,
} from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';

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
  private readonly authSession = inject(AuthSessionService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalErrorHandler = inject(GlobalErrorHandlerService);
  private readonly cacheService = inject(CacheService);
  private readonly store = inject<Store<AppState>>(Store);
  private readonly destroyRef = inject(DestroyRef);

  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);
  private readonly cacheTtlMs = 5 * 60 * 1000;

  readonly searchControl = new FormControl<string>('', { nonNullable: true });
  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();
  readonly searchResults$: Observable<IUserDados[]> = this.store.select(
    selectFriendSearchResults
  );
  readonly hasResults$ = this.store.select(selectHasFriendSearchResults);

  ngOnInit(): void {
    this.searchControl.valueChanges
      .pipe(
        map((term) => this.normalizeSearchTerm(term)),
        debounceTime(500),
        distinctUntilChanged(),
        switchMap((term) =>
          term ? this.searchFriends(term) : this.clearSearchResults()
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  /**
   * Busca usuários e mantém o resultado apenas em memória.
   *
   * A chave inclui o UID autenticado e um hash do termo. Assim:
   * - contas diferentes não reutilizam resultados entre si;
   * - o termo pesquisado não fica exposto em chaves ou logs;
   * - o histórico de busca não é persistido no IndexedDB.
   */
  private searchFriends(searchTerm: string): Observable<void> {
    this.updateLoadingState(true);

    return this.authSession.readyUid$.pipe(
      take(1),
      switchMap((uid) => {
        const safeUid = this.normalizeUid(uid);
        if (!safeUid) {
          return throwError(
            () => new Error('Sessão autenticada indisponível para pesquisar usuários.')
          );
        }

        const cacheKey = this.cacheKey(safeUid, searchTerm);

        return this.cacheService.get<IUserDados[]>(cacheKey).pipe(
          take(1),
          switchMap((cached) => {
            if (cached !== null) return of(cached);

            return this.friendship.searchUsers(searchTerm).pipe(
              tap((results) => {
                this.cacheService.set(
                  cacheKey,
                  results,
                  this.cacheTtlMs,
                  { persist: false }
                );
              })
            );
          }),
          tap((results) => {
            this.store.dispatch(loadSearchResultsSuccess({ results }));
          })
        );
      }),
      map(() => void 0),
      catchError((error: unknown) => {
        this.reportError(error);
        return of(void 0);
      }),
      finalize(() => this.updateLoadingState(false))
    );
  }

  private clearSearchResults(): Observable<void> {
    this.updateLoadingState(false);
    this.store.dispatch(loadSearchResultsSuccess({ results: [] }));
    return of(void 0);
  }

  private cacheKey(uid: string, normalizedTerm: string): string {
    return `search:${uid}:${this.hashSearchTerm(normalizedTerm)}`;
  }

  private normalizeUid(uid: string | null | undefined): string {
    return String(uid ?? '').trim();
  }

  private normalizeSearchTerm(value: string | null | undefined): string {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('pt-BR');
  }

  private hashSearchTerm(value: string): string {
    let hash = 2_166_136_261;

    for (const character of value) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16_777_619);
    }

    return (hash >>> 0).toString(36);
  }

  private updateLoadingState(state: boolean): void {
    this.isLoadingSubject.next(state);
  }

  private reportError(error: unknown): void {
    const normalizedError =
      error instanceof Error ? error : new Error('Erro inesperado ao buscar usuários.');

    (normalizedError as Error & { context?: Record<string, unknown> }).context = {
      scope: 'FriendSearchComponent',
      operation: 'searchFriends',
    };

    this.globalErrorHandler.handleError(normalizedError);
    this.errorNotifier.showError('Erro ao buscar usuários.');
  }
}
