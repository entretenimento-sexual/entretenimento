// src\app\user-profile\user-profile.resolve.ts
import { Injectable } from '@angular/core';
import { Resolve, ActivatedRouteSnapshot } from '@angular/router';
import { Observable, of } from 'rxjs';

import { UserProfileService } from './user-profile.service.js';

@Injectable()
export class UserProfileResolve implements Resolve<any> {
  constructor(private userProfileService: UserProfileService) { }

  resolve(route: ActivatedRouteSnapshot): Observable<any> {
    const userId = route.paramMap.get('userId');
    if (userId) {
      return this.userProfileService.getUserProfile(userId);
    } else {
      // Você pode retornar um Observable vazio ou manipular o caso em que userId é nulo.
      return of(null);
    }
  }
}
