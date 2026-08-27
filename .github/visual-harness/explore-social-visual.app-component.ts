import { Component } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Observable } from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
} from 'rxjs/operators';

/**
 * AppComponent exclusivo das configurações `*-explore-social-visual`.
 *
 * SUPRESSÃO EXPLÍCITA DO HARNESS:
 * - não inicia AuthOrchestratorService;
 * - não inicia PresenceOrchestratorService;
 * - não inicia reconciliação/acesso de assinatura;
 * - não inicia diagnósticos globais de autenticação/rota.
 *
 * Motivo:
 * o usuário do harness é propositalmente fictício. Iniciar os orquestradores
 * reais faria o shell tentar sincronizar Firestore/Functions e exibir erros de
 * permissão sem relação com `/descobrir`, contaminando screenshots e console.
 *
 * Este arquivo fica fora de `src/` para não participar do build normal. Depois
 * que o build real do ambiente passa, o workflow sobrescreve temporariamente
 * `src/app/app.component.ts` no checkout efêmero. Assim o AppModule mantém o
 * mesmo caminho/declaration context e o template raiz continua real.
 */
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: false,
})
export class AppComponent {
  title = 'entretenimento';

  readonly showFooter$: Observable<boolean> = this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    startWith(null),
    map(() => this.router.url || '/'),
    map((url) => !this.shouldHideFooter(url)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(private readonly router: Router) {}

  private shouldHideFooter(url: string): boolean {
    const clean = this.normalizeUrl(url);

    return [
      '/admin-dashboard',
      '/billing',
      '/chat',
      '/checkout',
      '/dashboard',
      '/descobrir',
      '/friends',
      '/media',
      '/notificacoes',
      '/outro-perfil',
      '/perfil',
      '/preferencias',
      '/principal',
      '/profile-list',
      '/subscription-plan',
    ].some((prefix) => clean === prefix || clean.startsWith(`${prefix}/`));
  }

  private normalizeUrl(url: string): string {
    return String(url ?? '').trim().split('?')[0].split('#')[0] || '/';
  }
}
