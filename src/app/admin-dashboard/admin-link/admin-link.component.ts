// src/app/admin-dashboard/admin-link/admin-link.component.ts
// Link discreto para o painel administrativo, visível apenas para admins.
// - Verifica claims de admin no token do Firebase Auth.
// - Opcional: pode ser configurado para aparecer apenas em rotas específicas (ex: login).
// IMPORTANTE: componente standalone e leve (sem módulos pesados).
// Não esquecer comentários explicativos, especialmente sobre a lógica de exibição baseada em claims e rotas.

import { AsyncPipe, CommonModule, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink, NavigationEnd } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { combineLatest, from, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, map, shareReplay, startWith, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-admin-link',
  standalone: true,
  imports: [NgIf, CommonModule, AsyncPipe, RouterLink],
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

  /**
   * Só é true para quem tem claim de admin.
   *
   * IMPORTANTE:
   * - NÃO use getIdTokenResult(true) aqui.
   *   "true" força refresh do token e pode causar loop com onIdTokenChanged.
   * - getIdTokenResult() sem parâmetros usa o token já em cache (sem forçar refresh).
   */
  isAdmin$ = user(this.auth).pipe(
    switchMap(u => u ? from(u.getIdTokenResult(/* forceRefresh */ false)) : of(null)),
    map(res => {
      const c: any = res?.claims || {};
      return !!c.admin || c.role === 'admin' || (Array.isArray(c.roles) && c.roles.includes('admin'));
    }),
    distinctUntilChanged(),
    // garante estabilidade e evita recomputação se houver múltiplos subscribers
    shareReplay({ bufferSize: 1, refCount: true }),
    // falha segura: não exibe o link
    catchError(() => of(false))
  );

  /** Opcional: exibir só em rotas específicas (ex.: login/landing) */
  private onlyOnRoutes = new Set<string>([
    // '', '/', '/login', '/dashboard/principal'
    // deixe vazio para mostrar em todas as páginas autenticadas
  ]);

  /**
   * Stream da rota atual:
   * - Usa urlAfterRedirects para refletir redirects.
   * - startWith garante valor inicial (não “espera” o primeiro evento).
   */
  route$ = this.router.events.pipe(
    filter(e => e instanceof NavigationEnd),
    map(e => (e as NavigationEnd).urlAfterRedirects || '/'),
    startWith(this.router.url || '/'),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * show$:
   * - Combina "é admin?" + "rota atual" e decide se mostra.
   * - Evita switchMap aninhado (mais simples e previsível).
   */
  show$ = combineLatest([this.isAdmin$, this.route$]).pipe(
    map(([isAdmin, url]) => {
      if (!isAdmin) return false;
      if (this.onlyOnRoutes.size === 0) return true;

      // match “prefix” simples
      for (const base of this.onlyOnRoutes) {
        if (url === base || url.startsWith(base + '/')) return true;
      }
      return false;
    }),
    distinctUntilChanged()
  );
} // Linha 108
