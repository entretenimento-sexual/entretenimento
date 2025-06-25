// src/app/app.component.ts
import { Component, OnInit, Renderer2 } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  standalone: false
})
export class AppComponent implements OnInit {
  title = 'entretenimento';

  constructor(private router: Router,
              private renderer: Renderer2) { }

  ngOnInit(): void {
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        if (/\/chat\//.test(event.url)) {
          // Remover a classe para ocultar o footer
          this.renderer.removeClass(document.body, 'show-footer');
        } else {
          // Adicionar a classe para exibir o footer
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

 