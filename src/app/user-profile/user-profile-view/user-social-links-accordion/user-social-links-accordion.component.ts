// src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component.ts
import { Component, OnDestroy, OnInit, input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatExpansionModule } from '@angular/material/expansion';
import { BehaviorSubject, combineLatest, of, Subject } from 'rxjs';
import { distinctUntilChanged, map, shareReplay, startWith, switchMap, takeUntil, tap } from 'rxjs/operators';

import { UserSocialLinksService } from 'src/app/core/services/user-profile/user-social-links.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

import { IUserSocialLinks } from 'src/app/core/interfaces/interfaces-user-dados/iuser-social-links';

type PlatformKey = keyof IUserSocialLinks;
type Platform = { key: PlatformKey; label: string; icon: string };

@Component({
  selector: 'app-social-links-accordion',
  templateUrl: './user-social-links-accordion.component.html',
  styleUrls: ['./user-social-links-accordion.component.css'],
  standalone: true,
  imports: [CommonModule, MatExpansionModule],
})
export class SocialLinksAccordionComponent implements OnInit, OnDestroy {
  // --- inputs ---
  readonly uid = input<string | null | undefined>(null);     // UID do perfil exibido
  readonly isOwner = input<boolean>(false);                   // Perfil é do usuário logado?

  // --- estado ---
  socialLinks: IUserSocialLinks | null = null;
  normalizedLinks: Partial<Record<PlatformKey, string>> = {};
  private destroy$ = new Subject<void>();
  private readonly loggedUid$ = new BehaviorSubject<string | null>(null);

  // Redes suportadas (expansível):
  socialMediaPlatforms: Platform[] = [
    { key: 'facebook', label: 'Facebook', icon: 'fab fa-facebook-square' },
    { key: 'instagram', label: 'Instagram', icon: 'fab fa-instagram' },
    { key: 'twitter', label: 'X (Twitter)', icon: 'fab fa-twitter' },
    { key: 'linkedin', label: 'LinkedIn', icon: 'fab fa-linkedin' },
    { key: 'youtube', label: 'YouTube', icon: 'fab fa-youtube' },
    { key: 'tiktok', label: 'TikTok', icon: 'fab fa-tiktok' },
    { key: 'snapchat', label: 'Snapchat', icon: 'fab fa-snapchat-ghost' },
    { key: 'sexlog', label: 'Sexlog', icon: 'fas fa-link' },
    { key: 'd4swing', label: 'D4', icon: 'fas fa-link' },
    { key: 'buppe', label: 'Buppe', icon: 'fas fa-link' },
  ];

  // injeções
  private readonly userSocialLinksService = inject(UserSocialLinksService);
  private readonly currentUserStore = inject(CurrentUserStoreService);
  private readonly session = inject(AuthSessionService);
  private readonly notify = inject(ErrorNotificationService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    // mantém UID logado do store
    this.currentUserStore.user$
      .pipe(
        startWith(undefined),
        map(u => u?.uid ?? null),
        distinctUntilChanged(),
        takeUntil(this.destroy$),
      )
      .subscribe(this.loggedUid$);

    // carrega os links do perfil (uid input)
    const profileUid = this.uid();
    if (!profileUid) {
      console.log('[SocialLinksAccordion] Nenhum uid passado ao componente.');
      return;
    }

    this.userSocialLinksService.getSocialLinks(profileUid)
      .pipe(
        takeUntil(this.destroy$),
        tap(links => {
          this.socialLinks = links ?? null;
          this.normalizedLinks = this.buildNormalizedLinks(links ?? {});
        })
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.destroy$.next(); this.destroy$.complete();
  }

  // ---------------------------
  // Helpers de renderização
  // ---------------------------
  anyLinks(): boolean {
    if (!this.socialLinks) return false;
    return this.socialMediaPlatforms.some(p => !!this.socialLinks?.[p.key]);
  }

  trackByKey = (_: number, item: Platform) => item.key;

  canEdit(): boolean {
    const logged = this.loggedUid$.value;
    const viewed = this.uid();
    return !!(this.isOwner() || (logged && viewed && logged === viewed));
  }

  // ---------------------------
  // Ações (CRUD)
  // ---------------------------
  updateSocialLink(key: PlatformKey, rawValue: string): void {
    if (!this.canEdit()) {
      this.notify.showError('Você não pode alterar as redes deste perfil.');
      return;
    }
    const ownerUid = this.uid();
    if (!ownerUid) return;

    const value = (rawValue ?? '').trim();
    const newLinks: IUserSocialLinks = {
      ...(this.socialLinks ?? {}),
      [key]: value,
    };

    // normaliza para exibição depois do persist
    const normalized = this.normalizeValue(key, value);

    this.userSocialLinksService.saveSocialLinks(ownerUid, newLinks)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.socialLinks = newLinks;
          this.normalizedLinks = {
            ...this.normalizedLinks,
            [key]: normalized,
          };
          this.notify.showSuccess('Redes sociais atualizadas.');
        },
        error: () => this.notify.showError('Não foi possível salvar agora. Tente novamente.'),
      });
  }

  removeLink(key: PlatformKey): void {
    if (!this.canEdit()) {
      this.notify.showError('Você não pode alterar as redes deste perfil.');
      return;
    }
    const ownerUid = this.uid();
    if (!ownerUid) return;

    this.userSocialLinksService.removeLink(ownerUid, key)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          if (this.socialLinks) {
            const clone = { ...this.socialLinks };
            delete clone[key];
            this.socialLinks = clone;
            const norm = { ...this.normalizedLinks };
            delete norm[key];
            this.normalizedLinks = norm;
          }
          this.notify.showSuccess('Link removido.');
        },
        error: () => this.notify.showError('Não foi possível remover agora.'),
      });
  }

  goToEditSocialLinks(): void {
    const uid = this.uid();
    if (!uid) return;
    this.router.navigate(['/perfil', uid, 'edit-profile-social-links']).catch(() => { });
  }

  // ---------------------------
  // Normalização de valores
  // ---------------------------
  private buildNormalizedLinks(links: Partial<IUserSocialLinks>): Partial<Record<PlatformKey, string>> {
    const out: Partial<Record<PlatformKey, string>> = {};
    (Object.keys(links) as PlatformKey[]).forEach(k => {
      const v = (links[k] ?? '').toString().trim();
      if (!v) return;
      out[k] = this.normalizeValue(k, v);
    });
    return out;
  }

  private normalizeValue(key: PlatformKey, value: string): string {
    const cleanHandle = (h: string) => h.replace(/^@/, '').trim();
    const ensureHttps = (url: string) =>
      /^(https?:)?\/\//i.test(url) ? (url.startsWith('http') ? url : `https:${url}`) : `https://${url}`;

    switch (key) {
      case 'facebook':
        return value.includes('facebook.com')
          ? ensureHttps(value)
          : `https://facebook.com/${cleanHandle(value)}`;

      case 'instagram':
        return value.includes('instagram.com')
          ? ensureHttps(value)
          : `https://instagram.com/${cleanHandle(value)}`;

      case 'twitter':
        // redireciona para X
        if (value.includes('twitter.com') || value.includes('x.com')) return ensureHttps(value);
        return `https://x.com/${cleanHandle(value)}`;

      case 'linkedin':
        // aceita profile/company. Se vier handle, assume /in/
        if (/linkedin\.com\/(in|company)\//i.test(value)) return ensureHttps(value);
        return `https://linkedin.com/in/${cleanHandle(value)}`;

      case 'youtube':
        // aceita links de canal/@handle; se handle, usa @
        if (value.includes('youtube.com') || value.includes('youtu.be')) return ensureHttps(value);
        return `https://youtube.com/@${cleanHandle(value)}`;

      case 'tiktok':
        return value.includes('tiktok.com')
          ? ensureHttps(value)
          : `https://tiktok.com/@${cleanHandle(value)}`;

      case 'snapchat':
        return value.includes('snapchat.com')
          ? ensureHttps(value)
          : `https://snapchat.com/add/${cleanHandle(value)}`;

      // domínios “outros”: apenas garante https
      case 'sexlog':
      case 'd4swing':
      case 'buppe':
      default:
        return ensureHttps(value);
    }
  }
}
