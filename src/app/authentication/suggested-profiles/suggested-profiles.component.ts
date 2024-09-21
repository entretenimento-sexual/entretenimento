// src\app\authentication\suggested-profiles\suggested-profiles.component.ts
import { Component, OnInit } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { SuggestionService } from 'src/app/core/services/data-handling/suggestion.service';

@Component({
  selector: 'app-suggested-profiles',
  templateUrl: './suggested-profiles.component.html',
  styleUrls: ['./suggested-profiles.component.css']
})
export class SuggestedProfilesComponent implements OnInit {

  suggestedProfiles: IUserDados[] = [];
  noProfilesMessage: string = '';
  matchingProfilesCount: number = 0;

  constructor(
    private authService: AuthService,
    private suggestionService: SuggestionService
  ) { }

  async ngOnInit() {
    try {
      const currentUser = await this.authService.getUserAuthenticated().toPromise();
      if (currentUser) {
        this.suggestedProfiles = await this.suggestionService.getSuggestedProfilesForUser(currentUser);
        this.matchingProfilesCount = this.suggestedProfiles.length;

        if (this.matchingProfilesCount === 0) {
          this.noProfilesMessage = "Atualmente, não temos perfis sugeridos para você. Por favor, volte mais tarde ou verifique novamente após um tempo.";
        }
      }
    } catch (error) {
      console.error('Erro ao buscar perfis sugeridos:', error);
    }
  }
}
