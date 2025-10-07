// src/app/app.component.ts
import { Component, OnInit, Renderer2 } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthOrchestratorService } from './core/services/autentication/auth/auth-orchestrator.service';
import { AuthDebugService } from './core/services/util-service/auth-debug.service';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: false
})
export class AppComponent implements OnInit {
  title = 'entretenimento';

  constructor(
    private router: Router,
    private renderer: Renderer2,
    private orchestrator: AuthOrchestratorService,
    private authDebug: AuthDebugService
  ) { }

  ngOnInit(): void {
    if (!environment.production) {
      this.authDebug.start();
    }

    // ✅ inicia watchers de sessão/doc
    this.orchestrator.start();

    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        if (/\/chat\//.test(event.url)) {
          this.renderer.removeClass(document.body, 'show-footer');
        } else {
          this.renderer.addClass(document.body, 'show-footer');
        }
      });
    }
   }
