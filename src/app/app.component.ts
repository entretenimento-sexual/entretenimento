// src/app/app.component.ts
// Não esqueça os comentários explicativos.
import { Component, OnInit, Renderer2, DestroyRef, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DOCUMENT } from '@angular/common';

import { AuthOrchestratorService } from './core/services/autentication/auth/auth-orchestrator.service';
import { AuthDebugService } from './core/services/util-service/auth-debug.service';
import { environment } from 'src/environments/environment';
import { PresenceOrchestratorService } from './core/services/presence/presence-orchestrator.service';
import { RouterDiagnosticsService } from './core/services/util-service/router-diagnostics.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: false
})
export class AppComponent implements OnInit {
  title = 'entretenimento';

  // ✅ teardown moderno (Angular 16+)
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  constructor(
    private router: Router,
    private renderer: Renderer2,
    private orchestrator: AuthOrchestratorService,
    private presenceOrchestrator: PresenceOrchestratorService,
    private authDebug: AuthDebugService,
    private readonly _routerDiag: RouterDiagnosticsService, 
  ) { }

  ngOnInit(): void {
    // ✅ diagnóstico do Router: inicia explicitamente (idempotente)
    this._routerDiag.start();

    if (!environment.production) {
      this.authDebug.start();
    }

    // ✅ inicia watchers de sessão/doc
    this.orchestrator.start();
    this.presenceOrchestrator.start();

    // ✅ Reage a navegações (usa urlAfterRedirects p/ refletir redirecionamentos)
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((event) => {
        const url = event.urlAfterRedirects || event.url;

        // Chat sem footer
        if (/^\/chat(\/|$)/.test(url)) {
          this.renderer.removeClass(this.document.body, 'show-footer');
        } else {
          this.renderer.addClass(this.document.body, 'show-footer');
        }
      });
  }
} // Linha 65
