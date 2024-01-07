//src\app\layout\other-user-profile-view\other-user-profile-view.component.ts
import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UsuarioService } from 'src/app/core/services/usuario.service';
import { SharedModule } from "../../shared/shared.module";

@Component({
    selector: 'app-other-user-profile-view',
    standalone: true,
    templateUrl: './other-user-profile-view.component.html',
    styleUrl: './other-user-profile-view.component.css',
    imports: [CommonModule, SharedModule]
})
export class OtherUserProfileViewComponent implements OnInit {
  userId: string | null | undefined;
  userProfile: IUserDados | null | undefined;
categoriasDePreferencias: any;

  constructor(
    private route: ActivatedRoute,
    private usuarioService: UsuarioService // Supondo que você tem um serviço para buscar dados do usuário
  ) { }

  ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('id');
    this.userId = idParam !== null ? idParam : null;

    if (this.userId) {
      this.loadUserProfile(this.userId);
    }
  }

  loadUserProfile(userId: string) {
    this.usuarioService.getUsuario(userId).subscribe(
      (profile) => {
        this.userProfile = profile;
      },
      (error) => {
        console.error('Erro ao carregar o perfil do usuário:', error);
      }
    );
  }
}
