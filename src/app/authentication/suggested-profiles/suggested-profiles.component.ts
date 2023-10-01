// src\app\authentication\suggested-profiles\suggested-profiles.component.ts
import { Component, OnInit } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FirestoreService } from 'src/app/core/services/autentication/firestore.service';
import { PreRegisterServiceService } from 'src/app/core/services/autentication/pre-register.service';

@Component({
  selector: 'app-suggested-profiles',
  templateUrl: './suggested-profiles.component.html',
  styleUrls: ['./suggested-profiles.component.css', '../authentication.css']
})
export class SuggestedProfilesComponent implements OnInit {

  suggestedProfiles: IUserDados[] = [];
  noProfilesMessage: string = '';
  matchingProfilesCount: number = 0;

  constructor(
    private firestoreService: FirestoreService,
    private preRegisterService: PreRegisterServiceService
  ) { }

  async ngOnInit() {
    try {
      const token = this.preRegisterService.getToken();
      const userPreferences = await this.firestoreService.getUserPreferencesByToken(token); // Este método precisa ser criado e implementado

      this.suggestedProfiles = await this.firestoreService.getSuggestedProfilesMatchingPreferences(userPreferences); // Este método também precisa ser criado e implementado

      this.matchingProfilesCount = this.suggestedProfiles.length;

      if (this.matchingProfilesCount === 0) {
        this.noProfilesMessage = "Atualmente, não temos perfis sugeridos para você. Por favor, volte mais tarde ou verifique novamente após um tempo.";
      }
    } catch (error) {
      console.error('Erro ao buscar perfis sugeridos:', error);
    }
  }
}
