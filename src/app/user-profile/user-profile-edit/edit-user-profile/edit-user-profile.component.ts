// src\app\user-profile\user-profile-edit\edit-user-profile\edit-user-profile.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

@Component({
  selector: 'app-edit-user-profile',
  templateUrl: './edit-user-profile.component.html',
  styleUrls: ['./edit-user-profile.component.css']
})
export class EditUserProfileComponent implements OnInit {
  userData: IUserDados;
  uid!: string;
  estados: any[] = [];
  municipios: any[] = [];
  genderOptions = [
    { value: 'homem', label: 'Homem' },
    { value: 'mulher', label: 'Mulher' },
    { value: 'casal-ele-ele', label: 'Casal (Ele/Ele)' },
    { value: 'casal-ele-ela', label: 'Casal (Ele/Ela)' },
    { value: 'casal-ela-ela', label: 'Casal (Ela/Ela)' },
    { value: 'travesti', label: 'Travesti' },
    { value: 'transexual', label: 'Transexual' },
    { value: 'crossdressers', label: 'Crossdressers' }
  ];

  constructor(
    private authService: AuthService,
    private usuarioService: UsuarioService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.userData = {} as IUserDados; // Inicializa userData
  }

  ngOnInit(): void {
    // Recuperar o UID do usuário
    this.uid = this.route.snapshot.paramMap.get('id') || '';
    this.loadEstados();
    if (this.uid) {
      this.usuarioService.getUsuario(this.uid).subscribe(async (user) => {
        if (user) {
          this.userData = user;
          if (this.userData.estado) {
            await this.onEstadoChange(this.userData.estado);
            // Verifica se o município pertence ao estado carregado
            if (!this.municipios.some(m => m.nome === this.userData.municipio)) {
              this.userData.municipio = '';
            }
        }
    }
      });
    }
  }

  async loadEstados() {
    try {
      const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados');
      this.estados = await response.json();
      this.estados.sort((a, b) => a.nome.localeCompare(b.nome)); // Ordena os estados

      // Se o usuário já tem um estado definido, carregue os municípios desse estado
      if (this.userData && this.userData.estado) {
        await this.onEstadoChange(this.userData.estado);
      }
    } catch (error) {
      console.error('Erro ao carregar os estados:', error);
    }
  }

  async onEstadoChange(estadoSigla: string) {
    try {
      const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${estadoSigla}/municipios`);
      this.municipios = await response.json();
      this.municipios.sort((a, b) => a.nome.localeCompare(b.nome)); // Ordena os municípios
      if (this.userData.estado !== estadoSigla) {
        this.userData.municipio = '';
      }
    } catch (error) {
      console.error('Erro ao carregar os municípios:', error);
    }
  }

  onSubmit(): void {
    // Lógica para atualizar os dados do usuário
    this.usuarioService.atualizarUsuario(this.uid, this.userData).subscribe(() => {
      // Redirecionar para a página de visualização do perfil após a atualização
      this.router.navigate(['/perfil', this.uid]);
    });
  }
}

