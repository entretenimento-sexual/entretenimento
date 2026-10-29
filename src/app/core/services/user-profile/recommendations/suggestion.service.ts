// Sugestões somente a partir da descoberta pública autorizada.
// Nunca consultar users/{uid} nem encaminhar o documento de conta ao card.
import { Injectable } from '@angular/core';
import { catchError, map, Observable, of } from 'rxjs';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FirestoreQueryService } from '../../data-handling/firestore-query.service';

const SUGGESTION_PUBLIC_SCAN_LIMIT = 120;

@Injectable({ providedIn: 'root' })
export class SuggestionService {
  constructor(private firestoreQuery: FirestoreQueryService) {}

  getSuggestedProfilesForUser(currentUser: IUserDados): Observable<IUserDados[]> {
    const municipio = this.normalize(currentUser.municipio);
    const gender = this.normalize(
      currentUser.declaredIdentityCode ?? currentUser.identityCode ?? currentUser.gender
    );
    const orientation = this.normalize(currentUser.orientation);

    // Preserve o filtro legado para perfis individuais, sem inferir casais,
    // preferências ou orientação de quem não declarou.
    if (
      !municipio ||
      !['homem', 'mulher'].includes(gender) ||
      !['heterossexual', 'homossexual', 'bissexual'].includes(orientation)
    ) {
      return of([]);
    }

    return this.firestoreQuery.getSuggestedProfiles(SUGGESTION_PUBLIC_SCAN_LIMIT).pipe(
      map((profiles) =>
        profiles
          .filter((profile) => {
            if (profile.uid === currentUser.uid ||
                this.normalize(profile.municipio) !== municipio) {
              return false;
            }

            const candidateGender = this.normalize(profile.identityCode ?? profile.gender);
            const candidateOrientation = this.normalize(profile.orientation);
            if (orientation === 'heterossexual') {
              return candidateGender === (gender === 'homem' ? 'mulher' : 'homem')
                && candidateOrientation === 'heterossexual';
            }
            if (orientation === 'homossexual') {
              return candidateGender === gender &&
                candidateOrientation === 'homossexual';
            }
            return ['homem', 'mulher'].includes(candidateGender) &&
              candidateOrientation === 'bissexual';
          })
          // Allowlist de apresentação: nunca propagar documentos inteiros,
          // idade legada, email, contato, flags privadas ou estado financeiro.
          .map((profile): IUserDados => ({
            uid: profile.uid,
            nickname: profile.nickname,
            photoURL: profile.photoURL ?? null,
            email: null,
            role: 'free',
            lastLogin: 0,
            gender: profile.gender,
            identityCode: profile.identityCode ?? null,
            orientation: profile.orientation,
            municipio: profile.municipio,
            estado: profile.estado,
            isOnline: profile.isOnline === true,
          }))
      ),
      catchError(() => of([] as IUserDados[]))
    );
  }

  private normalize(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }
}
