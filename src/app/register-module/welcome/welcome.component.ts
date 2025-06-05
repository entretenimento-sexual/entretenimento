//src\app\authentication\register-module\welcome\welcome.component.ts
import { Component } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { EmailVerificationService } from 'src/app/core/services/autentication/Register/email-verification.service';

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.component.html',
  styleUrls: ['./welcome.component.css'],
  standalone:false
})

export class WelcomeComponent {
  isLoading = false;
  message = '';

  constructor(
    private emailVerificationService: EmailVerificationService,
    private router: Router,
    private route: ActivatedRoute
  ) { }

  resendVerificationEmail(): void {
    this.isLoading = true;
    this.emailVerificationService.resendVerificationEmail().subscribe({
      next: (message) => {
        this.message = message;
      },
      error: () => {
        this.message = 'Erro ao reenviar o e-mail. Tente novamente mais tarde.';
      },
      complete: () => {
        this.isLoading = false;
      }
    });
  }


  proceedToDashboard(): void {
    const redirectTo = this.route.snapshot.queryParams['redirectTo'] || '/dashboard/principal';
    this.router.navigate([redirectTo]);
  }
}
