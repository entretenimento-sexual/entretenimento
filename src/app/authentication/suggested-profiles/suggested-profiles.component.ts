// src/app/authentication/suggested-profiles/suggested-profiles.component.ts
import { Component, OnInit, DestroyRef, inject } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { SuggestionService } from 'src/app/core/services/data-handling/suggestion.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { catchError, filter, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-suggested-profiles',
  templateUrl: './suggested-profiles.component.html',
  styleUrls: ['./suggested-profiles.component.css'],
  standalone: false
})
export class SuggestedProfilesComponent implements OnInit {
  suggestedProfiles: IUserDados[] = [];
  noProfilesMessage = '';
  matchingProfilesCount = 0;

  // ✅ injeta serviços (sem AuthService)
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly suggestionService = inject(SuggestionService);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.currentUserStore.user$
      .pipe(
        // user$ pode emitir undefined inicialmente; depois null (deslogado) ou IUserDados
        filter((u): u is IUserDados => !!u && !!u.uid),
        switchMap((currentUser) =>
          this.suggestionService.getSuggestedProfilesForUser(currentUser).pipe(
            catchError((err) => {
              console.log('Erro ao buscar perfis sugeridos:', err);
              // mantém componente estável
              return of<IUserDados[]>([]);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((profiles) => {
        this.suggestedProfiles = profiles ?? [];
        this.matchingProfilesCount = this.suggestedProfiles.length;

        this.noProfilesMessage =
          this.matchingProfilesCount === 0
            ? 'Atualmente, não temos perfis sugeridos para você. Por favor, volte mais tarde.'
            : '';
      });
  }
}
