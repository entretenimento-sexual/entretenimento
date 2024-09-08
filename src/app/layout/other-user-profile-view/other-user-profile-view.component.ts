//src\app\layout\other-user-profile-view\other-user-profile-view.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { SharedModule } from "../../shared/shared.module";

@Component({
  selector: 'app-other-user-profile-view',
  standalone: true, // Mantém standalone para evitar que o componente dependa de um módulo específico
  templateUrl: './other-user-profile-view.component.html',
  styleUrls: ['./other-user-profile-view.component.css'], // Corrige o nome da propriedade para 'styleUrls'
  imports: [CommonModule, SharedModule] // Importa módulos comuns e compartilhados
})
export class OtherUserProfileViewComponent implements OnInit {
  userId: string | null | undefined; // Armazena o ID do usuário a ser exibido
  userProfile: IUserDados | null | undefined = null; // Armazena os dados do perfil do usuário
  categoriasDePreferencias: { genero: string[], praticaSexual: string[] } = { genero: [], praticaSexual: [] }; // Inicializa categorias com arrays vazios

  isLoading: boolean = true; // Variável para gerenciar o estado de carregamento

  constructor(
    private route: ActivatedRoute, // Rota para acessar o parâmetro ID do usuário
    private usuarioService: UsuarioService // Serviço responsável por buscar os dados do usuário
  ) { }

  ngOnInit() {
    // Obtém o ID do usuário da rota
    this.userId = this.route.snapshot.paramMap.get('id');

    if (this.userId) {
      this.loadUserProfile(this.userId); // Carrega o perfil do usuário
    } else {
      this.isLoading = false; // Se o ID não for encontrado, interrompe o carregamento
    }
  }

  loadUserProfile(userId: string) {
    this.usuarioService.getUsuario(userId).subscribe(
      (profile) => {
        if (profile) {
          this.userProfile = profile; // Armazena o perfil do usuário retornado
          this.isLoading = false; // Define que o carregamento terminou

          // Verifica se 'preferences' existe e extrai 'genero' e 'praticaSexual' de lá
          this.categoriasDePreferencias = {
            genero: profile.preferences?.filter(pref => pref.includes('genero')) || [],
            praticaSexual: profile.preferences?.filter(pref => pref.includes('praticaSexual')) || []
          };
        }
      },
      (error) => {
        console.error('Erro ao carregar o perfil do usuário:', error);
        this.isLoading = false; // Interrompe o estado de carregamento no caso de erro
      }
    );
  }
}
