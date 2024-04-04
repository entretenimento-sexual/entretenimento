// src\app\authentication\progressive-signup\progressive-signup.component.ts
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { PreRegisterServiceService } from 'src/app/core/services/autentication/pre-register.service';

@Component({
  selector: 'app-progressive-signup',
  templateUrl: './progressive-signup.component.html',
  styleUrls: ['./progressive-signup.component.css', '../authentication.css']
})

export class ProgressiveSignupComponent {

  userPreferences: any = {};

  practices = [
    { value: 'swing', label: 'Swing' },
    { value: 'menage', label: 'Ménage' },
    { value: 'sameSex', label: 'Mesmo Sexo' },
    { value: 'exhibition', label: 'Exibição' },
    { value: 'professionals', label: 'Perfis de Profissionais' },
    { value: 'bdsm', label: 'BDSM' },
    { value: 'roleplay', label: 'Role-play' },
    { value: 'voyeurism', label: 'Voyeurismo' },
    { value: 'fetish', label: 'Fetiche' },
    { value: 'polyamory', label: 'Poliamor' },
    { value: 'transsexual', label: 'Transexual' },
    { value: 'crossdresser', label: 'Crossdresser' },
    { value: 'travesti', label: 'Travesti' },
    // ... outros valores ...
  ];

  constructor(
    private router: Router,
    private authService: AuthService,
    private preRegisterService: PreRegisterServiceService
    ) { }

  // Função para capturar as mudanças nos checkboxes
  capturePreference(event: any, preference: string) {
    if (event.target.checked) {
      this.userPreferences[preference] = true;
    } else {
      delete this.userPreferences[preference];
    }
  }

  async register() {
    try {
      // Aqui, você está apenas salvando as preferências do usuário usando o método saveUserPreferences
      await this.preRegisterService.saveUserPreferences(this.userPreferences);

      console.log('Preferências do usuário coletadas com sucesso.');

      // Navegue para o SuggestedProfilesComponent
      this.router.navigate(['/suggested-profiles']); // Certifique-se de que o caminho é correto

    } catch (error) {
      console.error('Erro durante o registro das preferências:', error);
    }
  }
}
