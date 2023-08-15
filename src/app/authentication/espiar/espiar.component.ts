//src\app\authentication\espiar\espiar.component.ts
import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-espiar',
  templateUrl: './espiar.component.html',
  styleUrls: ['./espiar.component.css']
})
export class EspiarComponent {

  constructor(private router: Router) { }

  navigateToRegister(): void {
    this.router.navigate(['/register-component']);
  }

  navigateToLogin(): void {
    this.router.navigate(['/login']);
  }
}
