// src\app\core\services\suggestion.service.ts
import { Injectable } from '@angular/core';
import { IUserDados } from '../../interfaces/iuser-dados';
import { FirestoreQueryService } from '../autentication/firestore-query.service';

@Injectable({
  providedIn: 'root'
})

export class SuggestionService {
  constructor(private firestoreQuery: FirestoreQueryService) { }

  async getSuggestedProfilesForUser(currentUser: IUserDados): Promise<IUserDados[]> {
    // Verifica se as informações necessárias estão disponíveis
    if (!currentUser.municipio || !currentUser.gender || !currentUser.orientation) {
      return [];
    }

    let suggestedProfiles: IUserDados[] = [];

    // Heterossexuais: sugerir perfis do sexo oposto no mesmo município
    if (currentUser.orientation === 'heterossexual') {
      const oppositeGender = currentUser.gender === 'homem' ? 'mulher' : 'homem';
      suggestedProfiles = await this.firestoreQuery.getProfilesByOrientationAndLocation(oppositeGender, 'heterossexual', currentUser.municipio);
    }

    // Homossexuais: sugerir perfis do mesmo sexo no mesmo município
    else if (currentUser.orientation === 'homossexual') {
      suggestedProfiles = await this.firestoreQuery.getProfilesByOrientationAndLocation(currentUser.gender, 'homossexual', currentUser.municipio);
    }

    // Bissexuais: sugerir perfis de ambos os sexos no mesmo município
    else if (currentUser.orientation === 'bissexual') {
      const profilesMen = await this.firestoreQuery.getProfilesByOrientationAndLocation('homem', 'bissexual', currentUser.municipio);
      const profilesWomen = await this.firestoreQuery.getProfilesByOrientationAndLocation('mulher', 'bissexual', currentUser.municipio);
      suggestedProfiles = [...profilesMen, ...profilesWomen];
    }

    return suggestedProfiles;
  }
}
