import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import type { CommunityOfficialTarget } from '../data-access/community-official-target.policy';
import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityProfilePublicCommunitiesRepository } from '../data-access/community-profile-public-communities.repository';
import { OfficialCommunitiesForTargetComponent } from '../official-communities-for-target/official-communities-for-target.component';
import { CommunityOfficialBadgeComponent } from '../presentation/community-official-badge.component';
import { ProfileOfficialCommunitiesComponent } from './profile-official-communities.component';

const PROFILE_ID = 'profile-12345678-1234-4123-8123-123456789abc';

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
            id: PROFILE_ID,
          },
          verified: true,
        },
      }
      : {}),
  } as CommunityPreviewCard;
}

describe('ProfileOfficialCommunitiesComponent', () => {
  const officialRepository = {
    getOfficialCommunitiesForTarget$: vi.fn(),
  };
  const publicMembershipRepository = {
    getProfilePublicCommunities$: vi.fn(),
  };
  const applicationError = {
    report: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    officialRepository.getOfficialCommunitiesForTarget$.mockImplementation(
      (_target: CommunityOfficialTarget) => of({
        items: [card('official', true)],
        nextCursor: null,
        generatedAt: 100,
      })
    );
    publicMembershipRepository.getProfilePublicCommunities$.mockReturnValue(of({
      items: [card('membership', true)],
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
    fixture.componentRef.setInput('profileId', PROFILE_ID.toUpperCase());
    fixture.componentRef.setInput(
      'includePublicMemberships',
      includePublicMemberships
    );
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  it('delega associação oficial ao componente transversal por alvo', () => {
    const fixture = create();

    expect(officialRepository.getOfficialCommunitiesForTarget$)
      .toHaveBeenCalledWith({
        type: 'profile',
        id: PROFILE_ID,
      }, 4);
    expect(
      publicMembershipRepository.getProfilePublicCommunities$
    ).not.toHaveBeenCalled();

    expect(
      fixture.debugElement.queryAll(
        By.directive(OfficialCommunitiesForTargetComponent)
      )
    ).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Comunidade oficial');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Participação em comunidades'
    );
  });

  it('mantém participação opt-in separada da associação oficial', () => {
    const fixture = create(true);

    expect(
      publicMembershipRepository.getProfilePublicCommunities$
    ).toHaveBeenCalledWith(PROFILE_ID, 4);
    expect(officialRepository.getOfficialCommunitiesForTarget$)
      .toHaveBeenCalledWith({
        type: 'profile',
        id: PROFILE_ID,
      }, 4);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Participação pública');
    expect(text).toContain('Participação em comunidades');
    expect(text).toContain('Vínculo verificado');
    expect(text).toContain('Comunidade oficial');

    expect(
      fixture.nativeElement.querySelectorAll('.profile-official-community')
    ).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelectorAll('.official-community')
    ).toHaveLength(1);

    // O selo oficial pertence apenas à associação oficial canônica.
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

    expect(text).toContain('Comunidade oficial');
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
