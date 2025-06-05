// src/app/core/guards/auth.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { from, Observable, of } from 'rxjs';
import { AuthService } from '../services/autentication/auth.service';
import { map, take, catchError, switchMap } from 'rxjs/operators';
import { getAuth, User } from 'firebase/auth';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) { }

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean> {
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
      return of(false);
    }

    // ✅ Garante que apenas usuários com token válido cheguem até aqui
    return from(currentUser.getIdTokenResult()).pipe(
      switchMap(() => from(currentUser.reload())),
      map(() => {
        if (!currentUser.emailVerified) {
          this.router.navigate(['/welcome']);
          return false;
        }
        return true;
      }),
      catchError(() => {
        this.router.navigate(['/login']);
        return of(false);
      })
    );
  }
}
