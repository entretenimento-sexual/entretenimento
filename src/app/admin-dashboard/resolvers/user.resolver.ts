// src/app/admin-dashboard/resolvers/user.resolver.ts
import { Injectable } from '@angular/core';
import { Resolve, ActivatedRouteSnapshot, Router } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { catchError, switchMap, take } from 'rxjs/operators';
import { AdminUserDetailService } from 'src/app/core/services/account-moderation/admin-user-detail.service';
import { type AdminUserRow } from 'src/app/core/services/account-moderation/admin-users-page.model';

@Injectable({ providedIn: 'root' })
export class UserResolver implements Resolve<AdminUserRow> {
  constructor(private adminUserDetail: AdminUserDetailService, private router: Router) { }

  resolve(route: ActivatedRouteSnapshot) {
    const uid = route.paramMap.get('uid')!;
    return this.adminUserDetail.getAdminUserDetail$(uid).pipe(
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
