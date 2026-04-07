//src\app\dashboard\suggested-profiles\suggested-profiles.component.ts
import { Component, OnInit, DestroyRef, inject, ChangeDetectionStrategy } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { catchError, filter, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SuggestionService } from 'src/app/core/services/user-profile/recommendations/suggestion.service';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-suggested-profiles',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule],
  templateUrl: './suggested-profiles.component.html',
  styleUrls: ['./suggested-profiles.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuggestedProfilesComponent implements OnInit {
  suggestedProfiles: IUserDados[] = [];
  noProfilesMessage = '';
  matchingProfilesCount = 0;

  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly suggestionService = inject(SuggestionService);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.currentUserStore.user$
      .pipe(
        filter((u): u is IUserDados => !!u && !!u.uid),
        switchMap((currentUser) =>
          this.suggestionService.getSuggestedProfilesForUser(currentUser).pipe(
            catchError(() => {
              // depois substitua pelo tratamento centralizado do projeto
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

  trackByUid(_: number, profile: IUserDados): string {
    return profile.uid;
  }
}