// src/app/user-profile/user-profile-edit/edit-profile-social-links/edit-profile-social-links.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { finalize, Subject, takeUntil } from 'rxjs';

import { IUserSocialLinks } from 'src/app/core/interfaces/interfaces-user-dados/iuser-social-links';
import {
  PROFILE_SOCIAL_LINK_FIELDS,
  ProfileSocialLinkField,
  ProfileSocialLinkKey,
} from 'src/app/core/catalogs/profile-social-links.catalog';
import { ProfileSocialLinksEditorFacade } from './profile-social-links-editor.facade';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Component({
  selector: 'app-edit-profile-social-links',
  templateUrl: './edit-profile-social-links.component.html',
  styleUrls: ['./edit-profile-social-links.component.css'],
  standalone: false,
  providers: [ProfileSocialLinksEditorFacade],
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
    private readonly router: Router,
    private readonly editorFacade: ProfileSocialLinksEditorFacade,
    private readonly notification: ErrorNotificationService
  ) {}

  ngOnInit(): void {
    this.uid = this.editorFacade.uid();

    if (!this.uid) {
      this.accessResolved = true;
      return;
    }

    this.editorFacade.access$
      .pipe(takeUntil(this.destroy$))
      .subscribe((access) => {
        this.accessResolved = access.resolved;
        this.isOwner = access.isOwner;
        this.canPublish = access.canPublish;
      });

    this.editorFacade.links$
      .pipe(takeUntil(this.destroy$))
      .subscribe((links) => {
        this.socialLinks = { ...links };
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

    this.editorFacade
      .save$(this.socialLinks)
      .pipe(
        finalize(() => {
          this.saving = false;
        }),
        takeUntil(this.destroy$)
      )
      .subscribe((saved) => {
        if (!saved) return;

        this.notification.showSuccess('Redes sociais publicadas.');
        this.router.navigate(['/perfil', this.uid]).catch(() => undefined);
      });
  }

  removerRede(key: ProfileSocialLinkKey): void {
    if (!this.uid || !this.isOwner || this.removingKey) return;
    if (!this.socialLinks[key]) return;

    this.removingKey = key;

    this.editorFacade
      .remove$(key)
      .pipe(
        finalize(() => {
          this.removingKey = null;
        }),
        takeUntil(this.destroy$)
      )
      .subscribe((removed) => {
        if (!removed) return;

        const next = { ...this.socialLinks };
        delete next[key];
        this.socialLinks = next;
        this.notification.showSuccess('Link removido.');
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


}
