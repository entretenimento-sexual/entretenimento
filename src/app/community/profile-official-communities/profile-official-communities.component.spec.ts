import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityProfilePublicCommunitiesRepository } from '../data-access/community-profile-public-communities.repository';
import { CommunityOfficialBadgeComponent } from '../presentation/community-official-badge.component';
import { ProfileOfficialCommunitiesComponent } from './profile-official-communities.component';

function card(
  communityId: string,
  official = false
): CommunityPreviewCard {
  return {
    communityId,
    name: `Comunidade ${communityId}`,
    slug: `comunidade-${communityId}`,
    description: 'Descrição pública.',
    source: { type: 'community', id: communityId },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 3, postCount: 0, mediaCount: 0 },
    access: {
      join: 'approval',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: [],
    ...(official
      ? {
        officialAssociation: {
          target: {
            type: 'profile',
            id: 'profile-1',
          },
          verified: true,
        },
      }
      : {}),
  } as CommunityPreviewCard;
}

describe('ProfileOfficialCommunitiesComponent', () => {
  const officialRepository = {
    getProfileOfficialCommunities$: vi.fn(),
  };
  const publicMembershipRepository = {
    getProfilePublicCommunities$: vi.fn(),
  };
  const applicationError = {
    report: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    officialRepository.getProfileOfficialCommunities$.mockReturnValue(of({
      items: [card('shared', true)],
      nextCursor: null,
      generatedAt: 100,
    }));
    publicMembershipRepository.getProfilePublicCommunities$.mockReturnValue(of({
      items: [card('shared', true)],
      nextCursor: null,
      generatedAt: 100,
    }));

    TestBed.configureTestingModule({
      imports: [ProfileOfficialCommunitiesComponent],
      providers: [
        provideRouter([]),
        { provide: CommunityPreviewRepository, useValue: officialRepository },
        {
          provide: CommunityProfilePublicCommunitiesRepository,
          useValue: publicMembershipRepository,
        },
        { provide: ApplicationErrorService, useValue: applicationError },
      ],
    });
  });

  function create(includePublicMemberships = false) {
    const fixture = TestBed.createComponent(ProfileOfficialCommunitiesComponent);
    fixture.componentRef.setInput('profileId', 'profile-1');
    fixture.componentRef.setInput(
      'includePublicMemberships',
      includePublicMemberships
    );
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  it('mantém o perfil próprio restrito à associação oficial por padrão', () => {
    const fixture = create();

    expect(
      officialRepository.getProfileOfficialCommunities$
    ).toHaveBeenCalledWith('profile-1', 4);
    expect(
      publicMembershipRepository.getProfilePublicCommunities$
    ).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Comunidades oficiais'
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Participação em comunidades'
    );
  });

  it('mantém participação opt-in e associação oficial em seções distintas', () => {
    const fixture = create(true);

    expect(
      publicMembershipRepository.getProfilePublicCommunities$
    ).toHaveBeenCalledWith('profile-1', 4);
    expect(
      officialRepository.getProfileOfficialCommunities$
    ).toHaveBeenCalledWith('profile-1', 4);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Participação pública');
    expect(text).toContain('Participação em comunidades');
    expect(text).toContain('Vínculo verificado');
    expect(text).toContain('Comunidades oficiais');
    expect(text).toContain(
      'Exibidas somente quando o perfil escolheu tornar a participação pública.'
    );

    // A mesma comunidade pode representar duas relações diferentes e, por isso,
    // não é deduplicada entre as seções.
    expect(
      fixture.nativeElement.querySelectorAll('.profile-official-community')
    ).toHaveLength(2);

    // O selo oficial pertence apenas à seção de associação oficial.
    expect(
      fixture.debugElement.queryAll(By.directive(CommunityOfficialBadgeComponent))
    ).toHaveLength(1);
  });

  it('preserva a associação oficial quando a fonte opt-in falha', () => {
    publicMembershipRepository.getProfilePublicCommunities$.mockReturnValue(
      throwError(() => ({
        code: 'functions/unavailable',
      }))
    );

    const fixture = create(true);
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Comunidades oficiais');
    expect(text).toContain(
      'As participações públicas não puderam ser carregadas.'
    );
    expect(applicationError.report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        feature: 'community',
        operation: 'loadProfilePublicCommunities',
      })
    );
  });
});
