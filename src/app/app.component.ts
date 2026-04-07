// src/app/app.component.ts
// Componente raiz da aplicação.
//
// Responsabilidades:
// - iniciar diagnósticos globais
// - iniciar orquestradores globais
// - manter a casca raiz mínima da aplicação
// - controlar a exibição global do footer por rota
//
// Importante:
// - este componente NÃO é dono de navbar/sidebar
// - o layout autenticado pertence ao LayoutShellComponent
// - o footer permanece global, com ocultação por rotas específicas
import { Component, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Observable } from 'rxjs';
import { distinctUntilChanged, filter, map, shareReplay, startWith } from 'rxjs/operators';

import { AuthOrchestratorService } from './core/services/autentication/auth/auth-orchestrator.service';
import { AuthDebugService } from './core/services/util-service/auth-debug.service';
import { environment } from 'src/environments/environment';
import { PresenceOrchestratorService } from './core/services/presence/presence-orchestrator.service';
import { RouterDiagnosticsService } from './core/services/util-service/router-diagnostics.service';
import { getApps } from 'firebase/app';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: false
})
export class AppComponent implements OnInit {
  title = 'entretenimento';

  /**
   * Footer global:
   * - aparece por padrão
   * - some apenas em rotas que pedem foco máximo (ex.: chat)
   */
  readonly showFooter$: Observable<boolean> = this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    startWith(null),
    map(() => this.router.url || '/'),
    map((url) => !this.shouldHideFooter(url)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly router: Router,
    private readonly orchestrator: AuthOrchestratorService,
    private readonly presenceOrchestrator: PresenceOrchestratorService,
    private readonly authDebug: AuthDebugService,
    private readonly routerDiag: RouterDiagnosticsService,
  ) {}

  ngOnInit(): void {
    this.routerDiag.start();

    if (!environment.production) {
      this.authDebug.start();

      const apps = getApps();
      // eslint-disable-next-line no-console
      console.log('[FIREBASE] apps count =', apps.length, apps.map(a => a.name));
    }

    this.orchestrator.start();
    this.presenceOrchestrator.start();
  }

  private shouldHideFooter(url: string): boolean {
    const clean = (url ?? '').trim();

    return (
      /^\/chat(\/|$)/.test(clean)
    );
  }
}
