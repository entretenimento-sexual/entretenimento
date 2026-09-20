import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommunityOfficialTargetType } from 'src/app/core/community/community-official-association.model';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import type { CommunityOfficialTarget } from '../data-access/community-official-target.policy';
import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityOfficialBadgeComponent } from '../presentation/community-official-badge.component';
import { OfficialCommunitiesForTargetComponent } from './official-communities-for-target.component';

function card(target: CommunityOfficialTarget): CommunityPreviewCard {
  return {
    communityId: `community-${target.type}`,
    name: `Comunidade ${target.type}`,
    slug: `comunidade-${target.type}`,
    description: 'Descrição pública.',
    source: { type: 'community', id: `community-${target.type}` },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 3, postCount: 0, mediaCount: 0 },
    access: {
      join: 'approval',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: [],
    officialAssociation: {
      target,
      verified: true,
    },
  } as CommunityPreviewCard;
}

describe('OfficialCommunitiesForTargetComponent', () => {
  const repository = {
    getOfficialCommunitiesForTarget$: vi.fn(),
  };
  const applicationError = {
    report: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repository.getOfficialCommunitiesForTarget$.mockImplementation(
      (target: CommunityOfficialTarget) => of({
        items: [card(target)],
        nextCursor: null,
        generatedAt: 100,
      })
    );

    TestBed.configureTestingModule({
      imports: [OfficialCommunitiesForTargetComponent],
      providers: [
        provideRouter([]),
        { provide: CommunityPreviewRepository, useValue: repository },
        { provide: ApplicationErrorService, useValue: applicationError },
      ],
    });
  });

  function create(type: CommunityOfficialTargetType, id: string) {
    const fixture = TestBed.createComponent(
      OfficialCommunitiesForTargetComponent
    );
    fixture.componentRef.setInput('targetType', type);
    fixture.componentRef.setInput('targetId', id);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  it.each([
    ['profile', 'profile-12345678-1234-4123-8123-123456789abc', 'perfil'],
    ['organization', 'organization-1', 'organização'],
    ['venue', 'venue-1', 'local'],
    ['event', 'event-1', 'evento'],
  ] as const)(
    'consulta o mesmo contrato canônico para %s',
    (type, id, targetLabel) => {
      const fixture = create(type, id);

      expect(repository.getOfficialCommunitiesForTarget$)
        .toHaveBeenCalledWith({ type, id }, 4);

      const text = fixture.nativeElement.textContent as string;
      expect(text).toContain('Comunidade oficial');
      expect(text.toLocaleLowerCase('pt-BR')).toContain(targetLabel);
      expect(
        fixture.debugElement.queryAll(
          By.directive(CommunityOfficialBadgeComponent)
        )
      ).toHaveLength(1);
    }
  );

  it('não cria auto-link quando a própria superfície já é a comunidade oficial', () => {
    const fixture = TestBed.createComponent(
      OfficialCommunitiesForTargetComponent
    );
    fixture.componentRef.setInput('targetType', 'venue');
    fixture.componentRef.setInput('targetId', 'venue-1');
    fixture.componentRef.setInput('currentCommunityId', 'community-venue');
    fixture.detectChanges();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.official-community--current')
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.official-community--current a')
    ).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'Esta é a comunidade oficial deste Local'
    );
  });

  it('fica oculto quando não existe associação oficial vigente', () => {
    repository.getOfficialCommunitiesForTarget$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: 100,
    }));

    const fixture = create('venue', 'venue-1');

    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('usa o tratamento centralizado de erro e permite retry', () => {
    repository.getOfficialCommunitiesForTarget$.mockReturnValue(
      throwError(() => ({ code: 'functions/unavailable' }))
    );

    const fixture = create('organization', 'organization-1');

    expect(fixture.nativeElement.textContent).toContain(
      'A associação oficial não pôde ser carregada.'
    );
    expect(applicationError.report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        feature: 'community',
        operation: 'loadOfficialCommunitiesForTarget',
        metadata: expect.objectContaining({
          targetType: 'organization',
          hasTargetId: true,
        }),
      })
    );
  });
});
