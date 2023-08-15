// src\app\user-profile\user-details\user-details.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { UserProfileService } from '../services-profile/user-profile.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';

@Component({
  selector: 'app-user-details',
  templateUrl: './user-details.component.html',
  styleUrls: ['./user-details.component.css']
})
export class UserDetailsComponent implements OnInit {
  userProfile: any;

  constructor(
    private route: ActivatedRoute,
    private userProfileService: UserProfileService,
    private authService: AuthService
  ) { }

  ngOnInit(): void {
    console.log('Verificando autenticação do usuário...');
    if (!this.authService.isUserAuthenticated()) {
      console.error('Erro: O usuário não está logado.');
      // Aqui você pode redirecionar para outra página ou mostrar uma mensagem de erro.
      return;
    }

    console.log('Verificando parâmetros da rota...');
    this.route.paramMap.subscribe(params => {
      const userId = params.get('userId');
      console.log('userId obtido:', userId);

      if (userId) {
        this.userProfileService.getUserProfile(userId).subscribe(profile => {
          if (profile) {
            this.userProfile = profile;
          } else {
            console.error('Erro: Perfil do usuário não encontrado.');
          }
        });
      } else {
        console.error('Erro: userId não fornecido.');
      }
    });
  }
}
