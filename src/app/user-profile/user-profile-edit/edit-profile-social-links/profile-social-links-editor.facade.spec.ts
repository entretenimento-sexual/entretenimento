import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { PlatformSubscriptionAccessService } from 'src/app/core/services/subscriptions/platform-subscription-access.service';
import { UserSocialLinksService } from 'src/app/core/services/user-profile/user-social-links.service';
import { ProfileSocialLinksEditorFacade } from './profile-social-links-editor.facade';

describe('ProfileSocialLinksEditorFacade', () => {
  function setup(input?: {
    uid?: string | null;
    authUid?: string | null;
    subscriber?: boolean;
    links?: any;
    saveError?: unknown;
    removeError?: unknown;
  }) {
    const saveSocialLinks = vi.fn(() =>
      input?.saveError
        ? throwError(() => input.saveError)
        : of(void 0)
    );
    const removeLink = vi.fn(() =>
      input?.removeError
        ? throwError(() => input.removeError)
        : of(void 0)
    );
    const getSocialLinks = vi.fn(() => of(input?.links ?? null));
    const report = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        ProfileSocialLinksEditorFacade,
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(
                input?.uid === null
                  ? {}
                  : { uid: input?.uid ?? 'owner' }
              ),
            },
          },
        },
        {
          provide: AccessControlService,
          useValue: {
            appUserResolved$: of(true),
            authUid$: of(input?.authUid ?? 'owner'),
          },
        },
        {
          provide: PlatformSubscriptionAccessService,
          useValue: {
            isSubscriber$: of(input?.subscriber ?? true),
          },
        },
        {
          provide: UserSocialLinksService,
          useValue: {
            getSocialLinks,
            saveSocialLinks,
            removeLink,
          },
        },
        {
          provide: ApplicationErrorService,
          useValue: { report },
        },
      ],
    });

    return {
      facade: TestBed.inject(ProfileSocialLinksEditorFacade),
      getSocialLinks,
      saveSocialLinks,
      removeLink,
      report,
    };
  }

  it('resolve proprietário assinante como apto a publicar', async () => {
    const { facade } = setup();

    await expect(
      new Promise((resolve) =>
        facade.access$.subscribe((value) => resolve(value))
      )
    ).resolves.toEqual({
      resolved: true,
      isOwner: true,
      canPublish: true,
    });
  });

  it('carrega links pela fonte canônica do perfil', async () => {
    const { facade, getSocialLinks } = setup({
      links: { instagram: '@perfil' },
    });

    await expect(
      new Promise((resolve) =>
        facade.links$.subscribe((value) => resolve(value))
      )
    ).resolves.toEqual({ instagram: '@perfil' });

    expect(getSocialLinks).toHaveBeenCalledWith('owner');
  });

  it('delegada publicação pública e retorna sucesso', async () => {
    const { facade, saveSocialLinks } = setup();

    await expect(
      new Promise((resolve) =>
        facade
          .save$({ instagram: '@perfil' })
          .subscribe((value) => resolve(value))
      )
    ).resolves.toBe(true);

    expect(saveSocialLinks).toHaveBeenCalledWith(
      'owner',
      { instagram: '@perfil' },
      {
        publishToPublic: true,
        notifyOnError: false,
      }
    );
  });

  it('falha de remoção é diagnosticada e convertida em resultado falso', async () => {
    const error = new Error('remove failed');
    const { facade, report } = setup({ removeError: error });

    await expect(
      new Promise((resolve) =>
        facade.remove$('instagram').subscribe((value) => resolve(value))
      )
    ).resolves.toBe(false);

    expect(report).toHaveBeenCalledWith(error, {
      feature: 'profile-social-links',
      operation: 'ProfileSocialLinksEditorFacade.remove',
      fallbackMessage: 'Não foi possível remover este link.',
      metadata: {
        scope: 'ProfileSocialLinksEditorFacade',
        key: 'instagram',
      },
    });
  });
});
