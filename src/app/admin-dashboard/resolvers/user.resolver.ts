// src/app/admin-dashboard/resolvers/user.resolver.ts
import { Injectable } from '@angular/core';
import { Resolve, ActivatedRouteSnapshot, Router } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { catchError, switchMap, take } from 'rxjs/operators';
import { UserManagementService } from 'src/app/core/services/account-moderation/user-management.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Injectable({ providedIn: 'root' })
export class UserResolver implements Resolve<IUserDados> {
  constructor(private userMgmt: UserManagementService, private router: Router) { }

  resolve(route: ActivatedRouteSnapshot) {
    const uid = route.paramMap.get('uid')!;
    return this.userMgmt.getUserById(uid).pipe(
      take(1),
      switchMap(user => {
        if (user) return of(user);
        this.router.navigate(['/admin-dashboard/users'], { replaceUrl: true });
        return EMPTY; // cancela a ativação
      }),
      catchError(() => {
        this.router.navigate(['/admin-dashboard/users'], { replaceUrl: true });
        return EMPTY;
      })
    );
  }
}
