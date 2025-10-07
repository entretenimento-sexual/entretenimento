// src/app/admin-dashboard/admin-link/admin-link.component.ts
import { AsyncPipe, CommonModule, NgIf } from '@angular/common';
import { Component, inject, signal, computed, effect } from '@angular/core';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { from, of } from 'rxjs';
import { filter, switchMap, map, startWith } from 'rxjs/operators';

@Component({
  selector: 'app-admin-link',
  standalone: true,
  imports: [CommonModule, AsyncPipe, RouterLink],
  template: `
    <div class="admin-link" *ngIf="(show$ | async)">
      <!-- link discreto, fora do fluxo normal -->
      <a routerLink="/admin-dashboard" rel="nofollow"
         aria-label="Abrir painel administrativo">
        Admin
      </a>
    </div>
  `,
  styles: [`
    .admin-link {
      display: block;
      text-align: center;
      margin: .5rem 0 1rem;
      font-size: .75rem;
      opacity: .25;
      user-select: none;
    }
    .admin-link a {
      text-decoration: none;
      outline: none;
    }
    .admin-link:hover, .admin-link:focus-within {
      opacity: .65;
    }
  `]
})
export class AdminLinkComponent {
  private auth = inject(Auth);
  private router = inject(Router);

  /** Só é true para quem tem claim de admin */
  isAdmin$ = user(this.auth).pipe(
    switchMap(u => u ? from(u.getIdTokenResult(/* forceRefresh */ true)) : of(null)),
    map(res => {
      const c: any = res?.claims || {};
      return !!c.admin || c.role === 'admin' || (Array.isArray(c.roles) && c.roles.includes('admin'));
    })
  );

  /** Opcional: exibir só em rotas específicas (ex.: login/landing) */
  private onlyOnRoutes = new Set<string>([
    // '', '/', '/login', '/dashboard/principal'
    // deixe vazio para mostrar em todas as páginas autenticadas
  ]);

  route$ = this.router.events.pipe(
    filter(e => e instanceof NavigationEnd),
    map(e => (e as NavigationEnd).urlAfterRedirects || '/'),
    startWith(this.router.url || '/')
  );

  show$ = this.isAdmin$.pipe(
    switchMap(isAdmin => this.route$.pipe(
      map(url => {
        if (!isAdmin) return false;
        if (this.onlyOnRoutes.size === 0) return true;  // mostrar sempre se não configurado
        // matches "prefix" simples
        for (const base of this.onlyOnRoutes) {
          if (url === base || url.startsWith(base + '/')) return true;
        }
        return false;
      })
    ))
  );
}
