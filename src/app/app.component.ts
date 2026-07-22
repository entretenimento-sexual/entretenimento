// src/app/app.component.ts
// Componente raiz da aplicação.
//
// Responsabilidades:
// - iniciar diagnósticos e orquestradores globais;
// - reconciliar e acompanhar a assinatura canônica;
// - manter a casca raiz mínima;
// - controlar a exibição global do footer por rota.
import { Component, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Observable } from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
} from 'rxjs/operators';

import { AuthOrchestratorService } from './core/services/autentication/auth/auth-orchestrator.service';
import { AuthDebugService } from './core/services/util-service/auth-debug.service';
import { environment } from 'src/environments/environment';
import { PresenceOrchestratorService } from './core/services/presence/presence-orchestrator.service';
import { PlatformSubscriptionAccessService } from './core/services/subscriptions/platform-subscription-access.service';
import { RouterDiagnosticsService } from './core/services/util-service/router-diagnostics.service';
import { PlatformSubscriptionReconciliationService } from './payments-core/application/platform-subscription-reconciliation.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: false,
})
export class AppComponent implements OnInit {
  title = 'entretenimento';

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
    private readonly subscriptionReconciliation: PlatformSubscriptionReconciliationService,
    private readonly subscriptionAccess: PlatformSubscriptionAccessService,
    private readonly authDebug: AuthDebugService,
    private readonly routerDiag: RouterDiagnosticsService
  ) {}

  ngOnInit(): void {
    this.routerDiag.start();

    if (!environment.production) {
      this.authDebug.start();
    }

    this.orchestrator.start();
    this.presenceOrchestrator.start();
    this.subscriptionReconciliation.start();
    this.subscriptionAccess.start();
  }

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
