// src\app\core\services\suggestion.service.ts
import { Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of } from 'rxjs';
import { FirestoreQueryService } from '../../data-handling/firestore-query.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Injectable({
  providedIn: 'root'
})

export class SuggestionService {
  constructor(private firestoreQuery: FirestoreQueryService) { }

  getSuggestedProfilesForUser(currentUser: IUserDados): Observable<IUserDados[]> {
    // Verifica se as informações necessárias estão disponíveis
    if (!currentUser.municipio || !currentUser.gender || !currentUser.orientation) {
      return of([]); // Retorna um Observable vazio se faltar algum dado
    }

    if (currentUser.orientation === 'heterossexual') {
      // Sugerir perfis do sexo oposto no mesmo município
      const oppositeGender = currentUser.gender === 'homem' ? 'mulher' : 'homem';
      return this.firestoreQuery
        .getProfilesByOrientationAndLocation(oppositeGender, 'heterossexual', currentUser.municipio)
        .pipe(catchError(() => of([]))); // Lida com erros retornando lista vazia
    } else if (currentUser.orientation === 'homossexual') {
      // Sugerir perfis do mesmo sexo no mesmo município
      return this.firestoreQuery
        .getProfilesByOrientationAndLocation(currentUser.gender, 'homossexual', currentUser.municipio)
        .pipe(catchError(() => of([]))); // Lida com erros retornando lista vazia
    } else if (currentUser.orientation === 'bissexual') {
      // Sugerir perfis de ambos os sexos no mesmo município
      const profilesMen$ = this.firestoreQuery.getProfilesByOrientationAndLocation(
        'homem',
        'bissexual',
        currentUser.municipio
      );
      const profilesWomen$ = this.firestoreQuery.getProfilesByOrientationAndLocation(
        'mulher',
        'bissexual',
        currentUser.municipio
      );

      // Combina os resultados de ambos os fluxos
      return forkJoin([profilesMen$, profilesWomen$]).pipe(
        map(([profilesMen, profilesWomen]) => [...profilesMen, ...profilesWomen]),
        catchError(() => of([])) // Lida com erros retornando lista vazia
      );
    }

    // Caso orientação não seja reconhecida, retorna vazio
    return of([]);
  }
}

