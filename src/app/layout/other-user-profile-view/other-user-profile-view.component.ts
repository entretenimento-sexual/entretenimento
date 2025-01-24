//src\app\layout\other-user-profile-view\other-user-profile-view.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { SharedModule } from "../../shared/shared.module";
import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { catchError, of } from 'rxjs';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';

@Component({
    selector: 'app-other-user-profile-view', // Mantém standalone para evitar que o componente dependa de um módulo específico
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
    private firestoreUserQuery: FirestoreUserQueryService,
    private firestoreQuery: FirestoreQueryService) { }

  ngOnInit() {
    // Obtém o ID do usuário da rota
    this.userId = this.route.snapshot.paramMap.get('id');

    if (this.userId) {
      this.loadUserProfile(this.userId); // Carrega o perfil do usuário
    } else {
      this.isLoading = false; // Se o ID não for encontrado, interrompe o carregamento
    }
  }

  loadUserProfile(userId: string): void {
    this.firestoreUserQuery.getUserById(userId)
      .pipe(
        catchError((error: any) => {
          console.error('[OtherUserProfileViewComponent] Erro ao buscar usuário:', error);
          this.isLoading = false;
          return of(null); // Retorna um observable vazio em caso de erro
        })
      )
      .subscribe((profile: IUserDados | null) => {
        if (profile) {
          this.userProfile = profile;
          this.categoriasDePreferencias = {
            genero: profile.preferences?.filter((pref: string) => pref.includes('genero')) || [],
            praticaSexual: profile.preferences?.filter((pref: string) => pref.includes('praticaSexual')) || [],
          };
        } else {
          console.warn('[OtherUserProfileViewComponent] Usuário não encontrado.');
        }
        this.isLoading = false;
      });
  }
}
