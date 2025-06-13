// src/app/authentication/register-module/welcome/welcome.component.ts
import { Component } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { EmailVerificationService } from 'src/app/core/services/autentication/register/email-verification.service';
import { ValidGenders } from 'src/app/core/enums/valid-genders.enum';
import { ValidPreferences } from 'src/app/core/enums/valid-preferences.enum';

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.component.html',
  styleUrls: ['./welcome.component.css'],
  standalone: false
})
export class WelcomeComponent {
  isLoading = false;
  message = '';

  // Gêneros e preferências disponíveis (enums)
  validGenders = Object.values(ValidGenders);
  validPreferences = Object.values(ValidPreferences);

  // Campos para coleta visual (não obrigatória)
  selectedGender: string = '';
  selectedPreferencesMap: { [key: string]: boolean } = {};

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

  // Getter para transformar o mapa em uma lista de preferências marcadas
  get selectedPreferences(): string[] {
    return Object.entries(this.selectedPreferencesMap)
      .filter(([_, isSelected]) => isSelected)
      .map(([preference]) => preference);
  }
}
