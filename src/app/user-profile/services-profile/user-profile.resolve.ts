// src\app\user-profile\user-profile.resolve.ts
import { Injectable } from '@angular/core';
import { Resolve, ActivatedRouteSnapshot } from '@angular/router';
import { Observable, of } from 'rxjs';
import { User } from 'src/app/core/interfaces/user.interface'; // Importar o tipo correto

import { UserProfileService } from './user-profile.service';

@Injectable()
export class UserProfileResolve implements Resolve<User | null> { // Ajustar o tipo aqui
  constructor(private userProfileService: UserProfileService) { }

  resolve(route: ActivatedRouteSnapshot): Observable<User | null> { // Ajustar o tipo aqui
    const userId = route.paramMap.get('userId');
    if (userId) {
      return this.userProfileService.getUserProfile(userId);
    } else {
      // Você pode retornar um Observable vazio ou manipular o caso em que userId é nulo.
      return of(null); // Retorna null se userId for nulo
    }
  }
}
