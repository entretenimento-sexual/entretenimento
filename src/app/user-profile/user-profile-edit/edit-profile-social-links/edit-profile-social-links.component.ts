// src\app\user-profile\user-profile-edit\edit-profile-social-links\edit-profile-social-links.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IUserSocialLinks } from 'src/app/core/interfaces/interfaces-user-dados/iuser-social-links';
import { UserSocialLinksService } from 'src/app/core/services/user-profile/user-social-links.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-edit-profile-social-links',
  templateUrl: './edit-profile-social-links.component.html',
  styleUrls: ['./edit-profile-social-links.component.css',],
  standalone: false
})
export class EditProfileSocialLinksComponent implements OnInit, OnDestroy {

  uid: string | null = null;                  // UID do usuário que estamos editando
  socialLinks: IUserSocialLinks | null = null; // Estado local com as redes
  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userSocialLinksService: UserSocialLinksService,
  ) { }

  ngOnInit(): void {
    // Obtém UID da rota
    this.uid = this.route.snapshot.paramMap.get('id');
    if (!this.uid) {
      // Se não tiver UID, podemos redirecionar ou exibir erro
      console.log('Nenhum UID encontrado na rota.');
      return;
    }

    // Carrega as redes do user
    this.userSocialLinksService.getSocialLinks(this.uid)
      .pipe(takeUntil(this.destroy$))
      .subscribe(links => {
        this.socialLinks = links || {};
      });
  }

  // Atualizar link no estado local
  updateLocalLink(key: keyof IUserSocialLinks, value: string): void {
    if (!this.socialLinks) {
      this.socialLinks = {};
    }
    this.socialLinks[key] = value;
  }

  // Salvar no backend
  salvarRedes(): void {
    if (!this.uid || !this.socialLinks) return;
    this.userSocialLinksService.saveSocialLinks(this.uid, this.socialLinks)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        // Depois de salvar, podemos voltar ao perfil
        this.router.navigate(['/perfil', this.uid]);
      });
  }

  // Remover link específico
  removerRede(key: keyof IUserSocialLinks): void {
    if (!this.uid || !this.socialLinks) return;
    this.userSocialLinksService.removeLink(this.uid, key)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        delete this.socialLinks?.[key];
      });
  }

  // Exemplo de cancelar edição e voltar sem salvar
  cancelar(): void {
    if (this.uid) {
      this.router.navigate(['/perfil', this.uid]);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

}
