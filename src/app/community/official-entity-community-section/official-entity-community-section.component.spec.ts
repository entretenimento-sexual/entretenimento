import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { OfficialEntityCommunitySectionComponent } from './official-entity-community-section.component';

describe('OfficialEntityCommunitySectionComponent', () => {
  const repository = {
    getOfficialCommunitiesForTarget$: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repository.getOfficialCommunitiesForTarget$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: 100,
    }));

    TestBed.configureTestingModule({
      imports: [OfficialEntityCommunitySectionComponent],
      providers: [
        provideRouter([]),
        { provide: CommunityPreviewRepository, useValue: repository },
        { provide: ApplicationErrorService, useValue: { report: vi.fn() } },
      ],
    });
  });

  it.each([
    ['organization', 'organization-1'],
    ['venue', 'venue-1'],
    ['event', 'event-1'],
  ] as const)('aceita somente alvo oficial de entidade %s', (targetType, targetId) => {
    const fixture = TestBed.createComponent(
      OfficialEntityCommunitySectionComponent
    );
    fixture.componentRef.setInput('targetType', targetType);
    fixture.componentRef.setInput('targetId', targetId);
    fixture.detectChanges();

    expect(repository.getOfficialCommunitiesForTarget$)
      .toHaveBeenCalledWith({ type: targetType, id: targetId }, 4);
  });

  it('não permite que Perfil atravesse o host de entidade', () => {
    const fixture = TestBed.createComponent(
      OfficialEntityCommunitySectionComponent
    );
    fixture.componentRef.setInput('targetType', 'profile' as never);
    fixture.componentRef.setInput(
      'targetId',
      'profile-12345678-1234-4123-8123-123456789abc'
    );
    fixture.detectChanges();

    expect(repository.getOfficialCommunitiesForTarget$).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });
});
