// src/app/core/guards/vip.guard.ts
import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { AuthService } from '../services/autentication/auth.service';

@Injectable({ providedIn: 'root' })
export class VipGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly router: Router
  ) { }

  canActivate(): Observable<boolean | UrlTree> {
    return this.authService.user$.pipe(
      take(1),
      map(user => {
        const role = (user?.role || 'free').toString().toLowerCase();
        const allowed = role === 'vip' || role === 'premium';
        return allowed ? true : this.router.createUrlTree(['/subscription-plan']);
      })
    );
  }
}
