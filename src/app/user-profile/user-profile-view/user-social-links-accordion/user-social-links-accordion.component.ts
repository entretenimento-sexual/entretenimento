//src\app\user-profile\user-profile-view\user-social-links-accordion\user-social-links-accordion.component.ts
import { Component, OnInit, OnDestroy, input } from '@angular/core';
import { UserSocialLinksService } from 'src/app/core/services/user-profile/user-social-links.service';
import { AuthService } from 'src/app/core/services/autentication/auth.service';
import { IUserSocialLinks } from 'src/app/core/interfaces/interfaces-user-dados/iuser-social-links';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Router } from '@angular/router';

import { MatExpansionModule } from '@angular/material/expansion';

@Component({
  selector: 'app-social-links-accordion',
  templateUrl: './user-social-links-accordion.component.html',
  styleUrls: ['./user-social-links-accordion.component.css'],
  standalone: true,
  imports: [MatExpansionModule]
})

export class SocialLinksAccordionComponent implements OnInit, OnDestroy {
  readonly uid = input<string | null | undefined>(null);
  readonly isOwner = input<boolean>(false);
  socialLinks: IUserSocialLinks | null = null;
  private destroy$ = new Subject<void>();

  // Lista de redes suportadas
  socialMediaPlatforms = [
    { key: 'facebook', label: 'Facebook', icon: 'fab fa-facebook-square' },
    { key: 'instagram', label: 'Instagram', icon: 'fab fa-instagram' },
    { key: 'twitter', label: 'Twitter', icon: 'fab fa-twitter' },
    { key: 'linkedin', label: 'LinkedIn', icon: 'fab fa-linkedin' },
    { key: 'youtube', label: 'YouTube', icon: 'fab fa-youtube' },
    { key: 'tiktok', label: 'TikTok', icon: 'fab fa-tiktok' },
    { key: 'snapchat', label: 'Snapchat', icon: 'fab fa-snapchat-ghost' },
    { key: 'sexlog', label: 'Sexlog', icon: '' },
    { key: 'd4swing', label: 'D4', icon: '' },
    { key: 'buppe', label: 'Buppe', icon: '' },

    // ... e assim por diante, até ~20
  ];

  constructor(
              private userSocialLinksService: UserSocialLinksService,
              private authService: AuthService,
              private router: Router,) { }

  ngOnInit(): void {
    const uid = this.uid();
    if (!uid) {
      console.log('[SocialLinksAccordion] Nenhum uid passado!');
      return;
    }
    this.userSocialLinksService.getSocialLinks(uid)
      .pipe(takeUntil(this.destroy$))
      .subscribe(links => {
        this.socialLinks = links;
      });
  }

  anyLinks(): boolean {
    if (!this.socialLinks) return false;
    return this.socialMediaPlatforms.some(platform => !!this.socialLinks![platform.key]);
  }

  // Exemplo de método p/ salvar ou atualizar
  updateSocialLink(key: keyof IUserSocialLinks, value: string): void {
    if (!this.authService.currentUser?.uid) return;
    const uid = this.authService.currentUser.uid;

    const newLinks = {
      ...(this.socialLinks || {}),
      [key]: value
    };

    this.userSocialLinksService.saveSocialLinks(uid, newLinks)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        // Atualiza local
        this.socialLinks = newLinks;
      });
  }

  // Exemplo de método p/ remover
  removeLink(key: keyof IUserSocialLinks): void {
    if (!this.authService.currentUser?.uid) return;
    const uid = this.authService.currentUser.uid;

    this.userSocialLinksService.removeLink(uid, key)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.socialLinks) {
          delete this.socialLinks[key];
        }
      });
  }

  goToEditSocialLinks(): void {
    const uid = this.uid();
    if (!uid) return;
    this.router.navigate(['/perfil', uid, 'edit-profile-social-links']);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
