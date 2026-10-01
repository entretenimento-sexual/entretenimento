import { Injectable, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  take,
} from 'rxjs/operators';

import { IUserSocialLinks } from 'src/app/core/interfaces/interfaces-user-dados/iuser-social-links';
import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { PlatformSubscriptionAccessService } from 'src/app/core/services/subscriptions/platform-subscription-access.service';
import { UserSocialLinksService } from 'src/app/core/services/user-profile/user-social-links.service';
import { ProfileSocialLinkKey } from 'src/app/core/catalogs/profile-social-links.catalog';

export interface ProfileSocialLinksAccessState {
  readonly resolved: boolean;
  readonly isOwner: boolean;
  readonly canPublish: boolean;
}

@Injectable()
export class ProfileSocialLinksEditorFacade {
  readonly uid = signal<string | null>(this.resolveUid());

  readonly access$: Observable<ProfileSocialLinksAccessState> =
    combineLatest([
      this.accessControl.appUserResolved$,
      this.accessControl.authUid$,
      this.subscriptionAccess.isSubscriber$,
    ]).pipe(
      map(([resolved, authUid, isSubscriber]) => {
        const uid = this.uid();

        if (!resolved) {
          return {
            resolved: false,
            isOwner: false,
            canPublish: false,
          };
        }

        const isOwner = !!uid && !!authUid && authUid === uid;

        return {
          resolved: true,
          isOwner,
          canPublish: isOwner && isSubscriber,
        };
      }),
      distinctUntilChanged(
        (a, b) =>
          a.resolved === b.resolved &&
          a.isOwner === b.isOwner &&
          a.canPublish === b.canPublish
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly links$: Observable<IUserSocialLinks> = this.uid()
    ? this.userSocialLinksService
        .getSocialLinks(this.uid()!)
        .pipe(
          take(1),
          map((links) => (links ? { ...links } : {})),
          catchError((error) => {
            this.report(
              error,
              'ProfileSocialLinksEditorFacade.load',
              'Não foi possível carregar suas redes sociais.'
            );
            return of({});
          }),
          shareReplay({ bufferSize: 1, refCount: true })
        )
    : of({});

  constructor(
    private readonly route: ActivatedRoute,
    private readonly accessControl: AccessControlService,
    private readonly subscriptionAccess: PlatformSubscriptionAccessService,
    private readonly userSocialLinksService: UserSocialLinksService,
    private readonly applicationError: ApplicationErrorService
  ) {
    if (!this.uid()) {
      this.report(
        new Error('UID não encontrado para editar redes sociais.'),
        'ProfileSocialLinksEditorFacade.route',
        'UID não encontrado para editar redes sociais.'
      );
    }
  }

  save$(links: IUserSocialLinks): Observable<boolean> {
    const uid = this.uid();
    if (!uid) return of(false);

    return this.userSocialLinksService
      .saveSocialLinks(uid, links, {
        publishToPublic: true,
        notifyOnError: false,
      })
      .pipe(
        take(1),
        map(() => true),
        catchError((error) => {
          this.report(
            error,
            'ProfileSocialLinksEditorFacade.save',
            'Não foi possível publicar suas redes sociais.'
          );
          return of(false);
        })
      );
  }

  remove$(key: ProfileSocialLinkKey): Observable<boolean> {
    const uid = this.uid();
    if (!uid) return of(false);

    return this.userSocialLinksService
      .removeLink(uid, key, {
        publishToPublic: true,
        notifyOnError: false,
      })
      .pipe(
        take(1),
        map(() => true),
        catchError((error) => {
          this.report(
            error,
            'ProfileSocialLinksEditorFacade.remove',
            'Não foi possível remover este link.',
            { key }
          );
          return of(false);
        })
      );
  }

  private resolveUid(): string | null {
    const uid =
      this.route.snapshot.paramMap.get('uid') ??
      this.route.snapshot.paramMap.get('id');

    return String(uid ?? '').trim() || null;
  }

  private report(
    error: unknown,
    operation: string,
    fallbackMessage: string,
    metadata?: Readonly<Record<string, unknown>>
  ): void {
    this.applicationError.report(error, {
      feature: 'profile-social-links',
      operation,
      fallbackMessage,
      metadata: {
        scope: 'ProfileSocialLinksEditorFacade',
        ...(metadata ?? {}),
      },
    });
  }
}
