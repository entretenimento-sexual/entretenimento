// src/app/app.component.ts
import { Component, OnInit, Renderer2 } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthOrchestratorService } from './core/services/autentication/auth/auth-orchestrator.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: false
})
export class AppComponent implements OnInit {
  title = 'entretenimento';

  constructor(private router: Router,
              private renderer: Renderer2,
              private orchestrator: AuthOrchestratorService) { }

  ngOnInit(): void {
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

     // Inicializa tema baseado no localStorage
    const dark = localStorage.getItem('theme') === 'dark';
    this.setDarkMode(dark);
  }

  toggleDarkMode(): void {
    const root = document.documentElement;
    const isDark = root.classList.toggle('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }

  private setDarkMode(enable: boolean): void {
    const root = document.documentElement;
    if (enable) {
      root.classList.add('dark-mode');
    } else {
      root.classList.remove('dark-mode');
    }
  }
}

