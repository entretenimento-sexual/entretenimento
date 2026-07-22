// src/app/user-profile/user-profile-edit/edit-profile-social-links/edit-profile-social-links.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest, finalize, Subject, takeUntil } from 'rxjs';

import { IUserSocialLinks } from 'src/app/core/interfaces/interfaces-user-dados/iuser-social-links';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PlatformSubscriptionAccessService } from 'src/app/core/services/subscriptions/platform-subscription-access.service';
import { UserSocialLinksService } from 'src/app/core/services/user-profile/user-social-links.service';

type SocialLinkKey = keyof IUserSocialLinks;

interface SocialLinkField {
  readonly key: SocialLinkKey;
  readonly label: string;
  readonly icon: string;
  readonly placeholder: string;
}

@Component({
  selector: 'app-edit-profile-social-links',
  templateUrl: './edit-profile-social-links.component.html',
  styleUrls: ['./edit-profile-social-links.component.css'],
  standalone: false,
})
export class EditProfileSocialLinksComponent implements OnInit, OnDestroy {
  readonly fields: readonly SocialLinkField[] = [
    { key: 'instagram', label: 'Instagram', icon: 'fab fa-instagram', placeholder: '@usuario ou URL' },
    { key: 'facebook', label: 'Facebook', icon: 'fab fa-facebook', placeholder: 'perfil ou URL' },
    { key: 'twitter', label: 'X', icon: 'fab fa-x-twitter', placeholder: '@usuario ou URL' },
    { key: 'tiktok', label: 'TikTok', icon: 'fab fa-tiktok', placeholder: '@usuario ou URL' },
    { key: 'youtube', label: 'YouTube', icon: 'fab fa-youtube', placeholder: 'canal ou URL' },
    { key: 'snapchat', label: 'Snapchat', icon: 'fab fa-snapchat', placeholder: 'usuario ou URL' },
    { key: 'sexlog', label: 'Sexlog', icon: 'fas fa-link', placeholder: 'perfil ou URL' },
    { key: 'd4swing', label: 'D4', icon: 'fas fa-link', placeholder: 'perfil ou URL' },
    { key: 'hotvips', label: 'Hotvips', icon: 'fas fa-link', placeholder: 'URL do perfil' },
    { key: 'privacy', label: 'Privacy', icon: 'fas fa-link', placeholder: 'perfil ou URL' },
    { key: 'onlyfans', label: 'OnlyFans', icon: 'fas fa-link', placeholder: 'perfil ou URL' },
    { key: 'fansly', label: 'Fansly', icon: 'fas fa-link', placeholder: 'perfil ou URL' },
    { key: 'linktree', label: 'Linktree', icon: 'fas fa-link', placeholder: 'URL pública' },
  ];

  uid: string | null = null;
  socialLinks: IUserSocialLinks = {};

  accessResolved = false;
  isOwner = false;
  canPublish = false;
  saving = false;
  removingKey: SocialLinkKey | null = null;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly accessControl: AccessControlService,
    private readonly subscriptionAccess: PlatformSubscriptionAccessService,
    private readonly userSocialLinksService: UserSocialLinksService,
    private readonly globalError: GlobalErrorHandlerService,
    private readonly notification: ErrorNotificationService
  ) {}

  ngOnInit(): void {
    this.uid = String(
      this.route.snapshot.paramMap.get('uid') ??
        this.route.snapshot.paramMap.get('id') ??
        ''
    ).trim() || null;

    if (!this.uid) {
      this.reportError('UID não encontrado para editar redes sociais.', {
        op: 'ngOnInit',
      });
      this.accessResolved = true;
      return;
    }

    combineLatest([
      this.accessControl.appUserResolved$,
      this.accessControl.authUid$,
      this.subscriptionAccess.isSubscriber$,
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([resolved, authUid, isSubscriber]) => {
        if (!resolved) return;

        this.accessResolved = true;
        this.isOwner = !!authUid && authUid === this.uid;
        this.canPublish = this.isOwner && isSubscriber;
      });

    this.userSocialLinksService
      .getSocialLinks(this.uid)
      .pipe(takeUntil(this.destroy$))
      .subscribe((links) => {
        this.socialLinks = links ? { ...links } : {};
      });
  }

  updateLocalLink(key: SocialLinkKey, value: string): void {
    if (!this.canPublish) return;
    this.socialLinks = {
      ...this.socialLinks,
      [key]: value,
    };
  }

  salvarRedes(): void {
    if (!this.uid || this.saving) return;

    if (!this.canPublish) {
      this.notification.showWarning(
        'Uma assinatura ativa é necessária para publicar redes sociais.'
      );
      return;
    }

    this.saving = true;

    this.userSocialLinksService
      .saveSocialLinks(this.uid, this.socialLinks, {
        publishToPublic: true,
        notifyOnError: false,
      })
      .pipe(
        finalize(() => {
          this.saving = false;
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: () => {
          this.notification.showSuccess('Redes sociais publicadas.');
          this.router.navigate(['/perfil', this.uid]).catch(() => undefined);
        },
        error: () => {
          this.notification.showError(
            'Não foi possível publicar suas redes sociais.'
          );
        },
      });
  }

  removerRede(key: SocialLinkKey): void {
    if (!this.uid || !this.isOwner || this.removingKey) return;
    if (!this.socialLinks[key]) return;

    this.removingKey = key;

    this.userSocialLinksService
      .removeLink(this.uid, key, {
        publishToPublic: true,
        notifyOnError: false,
      })
      .pipe(
        finalize(() => {
          this.removingKey = null;
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: () => {
          const next = { ...this.socialLinks };
          delete next[key];
          this.socialLinks = next;
          this.notification.showSuccess('Link removido.');
        },
        error: () => {
          this.notification.showError('Não foi possível remover este link.');
        },
      });
  }

  abrirPlanos(): void {
    this.router.navigate(['/subscription-plan']).catch(() => undefined);
  }

  cancelar(): void {
    if (this.uid) {
      this.router.navigate(['/perfil', this.uid]).catch(() => undefined);
    }
  }

  trackField(_: number, field: SocialLinkField): SocialLinkKey {
    return field.key;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private reportError(
    message: string,
    context: Record<string, unknown>
  ): void {
    const error = new Error(message);
    (error as any).context = {
      scope: 'EditProfileSocialLinksComponent',
      ...context,
    };
    (error as any).skipUserNotification = true;

    try {
      this.globalError.handleError(error);
    } catch {
      // noop
    }

    this.notification.showError(message);
  }
}
