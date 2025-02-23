//src\app\layout\other-user-profile-view\other-user-profile-view.component.ts
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { SharedModule } from "../../shared/shared.module";
import { catchError, of } from 'rxjs';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { SocialLinksAccordionComponent } from 'src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component';

import { UserProfilePreferencesComponent } from 'src/app/user-profile/user-profile-view/user-profile-preferences/user-profile-preferences.component';

@Component({
    selector: 'app-other-user-profile-view',
    templateUrl: './other-user-profile-view.component.html',
    styleUrls: ['./other-user-profile-view.component.css'],
    standalone: true,
    imports: [
      CommonModule,
      SharedModule,
      SocialLinksAccordionComponent,
      UserProfilePreferencesComponent,
    ]
  })

export class OtherUserProfileViewComponent implements OnInit {
  uid: string | null = null; // Armazena o ID do usuário a ser exibido
  userProfile: IUserDados | null | undefined = null; // Armazena os dados do perfil do usuário
  categoriasDePreferencias = {
                              genero: [] as string[],
                              praticaSexual: [] as string[], };// Inicializa categorias com arrays vazios

  isLoading: boolean = true; // Variável para gerenciar o estado de carregamento

  constructor(
              private route: ActivatedRoute, // Rota para acessar o parâmetro ID do usuário
              private firestoreUserQuery: FirestoreUserQueryService,
              private cdr: ChangeDetectorRef) { }

  ngOnInit() {
    // Obtém o ID do usuário da rota
    this.uid = this.route.snapshot.paramMap.get('id');

    if (this.uid) {
      this.loadUserProfile(this.uid); // Carrega o perfil do usuário
    } else {
      this.isLoading = false; // Se o ID não for encontrado, interrompe o carregamento
    }
  }

  loadUserProfile(uid: string): void {
    this.firestoreUserQuery.getUserById(uid)
      .pipe(
        catchError((error: any) => {
          console.log('[OtherUserProfileViewComponent] Erro ao buscar usuário:', error);
          this.isLoading = false;
          return of(null);
        })
      )
      .subscribe((profile: IUserDados | null) => {
        if (profile) {
          this.userProfile = {
            ...profile,
            preferences: profile.preferences && Array.isArray(profile.preferences)
              ? profile.preferences
              : [] // 🛠 Garante que preferences seja um array
          };

          console.log('[OtherUserProfileViewComponent] Municipio:', profile.municipio);
          console.log('[OtherUserProfileViewComponent] Estado:', profile.estado);
          console.log('[OtherUserProfileViewComponent] Nickname:', profile.nickname);
          console.log('[OtherUserProfileViewComponent] Preferences:', this.userProfile.preferences); // Agora preferences não será undefined

          this.categoriasDePreferencias = {
            genero: this.userProfile.preferences?.filter((pref: string) => pref.includes('genero')) || [],
            praticaSexual: this.userProfile.preferences?.filter((pref: string) => pref.includes('praticaSexual')) || [],
          };

          this.cdr.detectChanges(); // Força a atualização do template
        } else {
          console.log('[OtherUserProfileViewComponent] Usuário não encontrado.');
        }
        this.isLoading = false;
      });
  }
}
