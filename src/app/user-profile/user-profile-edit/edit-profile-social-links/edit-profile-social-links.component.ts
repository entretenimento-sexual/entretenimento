// src/app/user-profile/user-profile-edit/edit-profile-social-links/edit-profile-social-links.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest, finalize, Subject, takeUntil } from 'rxjs';

import { IUserSocialLinks } from 'src/app/core/interfaces/interfaces-user-dados/iuser-social-links';
import {
  PROFILE_SOCIAL_LINK_FIELDS,
  ProfileSocialLinkField,
  ProfileProfileSocialLinkKey,
} from 'src/app/core/catalogs/profile-social-links.catalog';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { PlatformSubscriptionAccessService } from 'src/app/core/services/subscriptions/platform-subscription-access.service';
import { UserSocialLinksService } from 'src/app/core/services/user-profile/user-social-links.service';

@Component({
  selector: 'app-edit-profile-social-links',
  templateUrl: './edit-profile-social-links.component.html',
  styleUrls: ['./edit-profile-social-links.component.css'],
  standalone: false,
})
export class EditProfileSocialLinksComponent implements OnInit, OnDestroy {
  readonly fields: readonly ProfileSocialLinkField[] =
    PROFILE_SOCIAL_LINK_FIELDS;

  uid: string | null = null;
  socialLinks: IUserSocialLinks = {};

  accessResolved = false;
  isOwner = false;
  canPublish = false;
  saving = false;
  removingKey: ProfileSocialLinkKey | null = null;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly accessControl: AccessControlService,
    private readonly subscriptionAccess: PlatformSubscriptionAccessService,
    private readonly userSocialLinksService: UserSocialLinksService,
    private readonly applicationError: ApplicationErrorService,
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

  updateLocalLink(key: ProfileSocialLinkKey, value: string): void {
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
        error: (error: unknown) => {
          this.applicationError.report(error, {
            feature: 'profile-social-links',
            operation: 'saveSocialLinks',
            fallbackMessage: 'Não foi possível publicar suas redes sociais.',
            metadata: {
              scope: 'EditProfileSocialLinksComponent',
            },
          });
        },
      });
  }

  removerRede(key: ProfileSocialLinkKey): void {
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
        error: (error: unknown) => {
          this.applicationError.report(error, {
            feature: 'profile-social-links',
            operation: 'removeSocialLink',
            fallbackMessage: 'Não foi possível remover este link.',
            metadata: {
              scope: 'EditProfileSocialLinksComponent',
              key,
            },
          });
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

  trackField(_: number, field: ProfileSocialLinkField): ProfileSocialLinkKey {
    return field.key;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private reportError(
    message: string,
    context: Readonly<Record<string, unknown>>
  ): void {
    this.applicationError.report(new Error(message), {
      feature: 'profile-social-links',
      operation: String(context['op'] ?? 'unknown'),
      fallbackMessage: message,
      metadata: {
        scope: 'EditProfileSocialLinksComponent',
        ...context,
      },
    });
  }
}
