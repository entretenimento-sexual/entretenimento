//src\app\app.component.ts
import { Component, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: false
})
export class AppComponent implements OnInit {
  constructor(private router: Router) { }
  title = 'entretenimento';
  showFooter: boolean = true;

  ngOnInit(): void {
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        // Ocultar o rodapé se a URL contiver 'chat-module'
        this.showFooter = !/\/chat\/[a-zA-Z0-9]+/.test(event.url);
      });
  }
}
