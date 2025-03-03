//src\app\layout\friend.management\friend-search\friend-search.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, switchMap, catchError, of, Observable, map } from 'rxjs';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserInteractionsService } from 'src/app/core/services/data-handling/user-interactions.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { CacheService } from 'src/app/core/services/general/cache/cache.service';
import { Store, select } from '@ngrx/store';
import { AppState } from 'src/app/store/states/app.state';
import { loadSearchResultsSuccess } from 'src/app/store/actions/actions.interactions/actions.friends';

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
  styleUrl: './friend-search.component.css'
})
export class FriendSearchComponent implements OnInit {
  searchControl = new FormControl('');
  isLoading$: Observable<boolean>;
  searchResults$: Observable<IUserDados[]>;

  constructor(
    private userInteractionsService: UserInteractionsService,
    private errorNotifier: ErrorNotificationService,
    private cacheService: CacheService,
    private store: Store<AppState>
  ) {
    this.isLoading$ = this.cacheService.get<boolean>('loadingSearch').pipe(map(value => value ?? false));
    this.searchResults$ = this.store.pipe(select(state => state.friends.searchResults));
  }

  ngOnInit(): void {
    this.searchControl.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      switchMap(searchTerm => this.searchFriends(searchTerm ?? '')) // 🔹 Garante que `searchTerm` nunca será `null`
    ).subscribe();
  }

  /**
   * Realiza a busca de amigos no Firestore e armazena no Store.
   * @param searchTerm Termo de busca (nickname ou UID).
   */
  private searchFriends(searchTerm: string): Observable<void> {
    if (!searchTerm.trim()) return of(); // Evita buscas vazias

    const cacheKey = `search:${searchTerm}`;
    this.updateLoadingState(true);

    return this.cacheService.get<IUserDados[]>(cacheKey).pipe(
      switchMap(cachedResults => {
        if (cachedResults) {
          this.updateLoadingState(false);
          this.store.dispatch(loadSearchResultsSuccess({ results: cachedResults })); // ✅ Usa Store
          return of();
        }

        return this.userInteractionsService.findUsersBySearchTerm(searchTerm).pipe(
          switchMap(results => {
            this.cacheService.set(cacheKey, results, 300000); // 🔥 Cache de 5 minutos
            this.store.dispatch(loadSearchResultsSuccess({ results })); // ✅ Atualiza Store
            this.updateLoadingState(false);
            return of();
          })
        );
      }),
      catchError(error => {
        this.updateLoadingState(false);
        this.errorNotifier.showError('Erro ao buscar usuários.', error.message);
        return of();
      })
    );
  }

  /**
   * Atualiza o estado de carregamento no CacheService.
   * @param state Estado do carregamento (true/false).
   */
  private updateLoadingState(state: boolean): void {
    this.cacheService.set('loadingSearch', state, 5000);
  }
}
