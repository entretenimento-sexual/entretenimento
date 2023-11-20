import { Component } from '@angular/core';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { UsuarioService } from 'src/app/core/services/usuario.service';

@Component({
  selector: 'app-user-profile-edit',
  templateUrl: './user-profile-edit.component.html',
  styleUrls: ['./user-profile-edit.component.css']
})
export class UserProfileEditComponent {
  selectedGenders: string[] = [];
  genderOptions = ['Homem', 'Mulher', 'Casal (Ele/Ele)', 'Casal (Ele/Ela)', 'Casal (Ela/Ela)', 'Travesti', 'Transexual', 'Crossdressers'];

  constructor(private authService: AuthService, private usuarioService: UsuarioService) { }
  ngOnInit(): void {
    // Carregar os dados do usuário
    const currentUser = this.authService.currentUser;
    if (currentUser) {
      // Carregar dados do usuário e preencher o formulário
      // Exemplo: this.selectedGenders = currentUser.genders;
    }
  }

  onSubmit(): void {
    // Aqui você terá a lógica para salvar as preferências atualizadas do usuário
    // As preferências selecionadas estarão disponíveis no array `selectedGenders`
  }
}
