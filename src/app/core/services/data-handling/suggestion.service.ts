// src\app\core\services\suggestion.service.ts
import { Injectable } from '@angular/core';
import { IUserDados } from '../../interfaces/iuser-dados';
import { FirestoreService } from '../autentication/firestore.service';


@Injectable({
  providedIn: 'root'
})
export class SuggestionService {
  constructor(private firestoreService: FirestoreService) { }

  async getSuggestedProfilesForUser(currentUser: IUserDados): Promise<IUserDados[]> {
    // Verifica se as informações necessárias estão disponíveis
    if (!currentUser.municipio || !currentUser.gender || !currentUser.orientation) {
      return [];
    }

    let suggestedProfiles: IUserDados[] = [];

    // Heterossexuais: sugerir perfis do sexo oposto no mesmo município
    if (currentUser.orientation === 'heterossexual') {
      const oppositeGender = currentUser.gender === 'homem' ? 'mulher' : 'homem';
      suggestedProfiles = await this.firestoreService.getProfilesByOrientationAndLocation(oppositeGender, 'heterossexual', currentUser.municipio);
    }

    // Homossexuais: sugerir perfis do mesmo sexo no mesmo município
    else if (currentUser.orientation === 'homossexual') {
      suggestedProfiles = await this.firestoreService.getProfilesByOrientationAndLocation(currentUser.gender, 'homossexual', currentUser.municipio);
    }

    // Bissexuais: sugerir perfis de ambos os sexos no mesmo município
    else if (currentUser.orientation === 'bissexual') {
      const profilesMen = await this.firestoreService.getProfilesByOrientationAndLocation('homem', 'bissexual', currentUser.municipio);
      const profilesWomen = await this.firestoreService.getProfilesByOrientationAndLocation('mulher', 'bissexual', currentUser.municipio);
      suggestedProfiles = [...profilesMen, ...profilesWomen];
    }

    return suggestedProfiles;
  }
}
