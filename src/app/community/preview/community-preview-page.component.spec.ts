import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityPreviewPageComponent } from './community-preview-page.component';

function preview() {
  return {
    community: {
      communityId: 'community-1',
      name: 'Comunidade do Centro',
      slug: 'comunidade-do-centro',
      description: 'Atualizações e fotos do local.',
      source: { type: 'venue' as const, id: 'venue-1' },
      avatarUrl: null,
      coverUrl: null,
      metrics: { memberCount: 12, postCount: 4, mediaCount: 3 },
      access: {
        join: 'approval' as const,
        minimumRole: null,
        requiresActiveSubscription: false,
      },
    },
    viewerMode: 'visitor' as const,
    canInteract: false,
    generatedAt: 123,
  };
}

describe('CommunityPreviewPageComponent', () => {
  const previewRepositoryMock = { getPreview$: vi.fn() };
  const feedRepositoryMock = { getPage$: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    previewRepositoryMock.getPreview$.mockReturnValue(of(preview()));
    feedRepositoryMock.getPage$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: 123 })
    );

    TestBed.configureTestingModule({
      imports: [CommunityPreviewPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ communityId: 'community-1' })),
          },
        },
        { provide: CommunityPreviewRepository, useValue: previewRepositoryMock },
        { provide: CommunityFeedRepository, useValue: feedRepositoryMock },
        { provide: ErrorNotificationService, useValue: { showError: vi.fn() } },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });
  });

  function createFixture() {
    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  function sectionButton(
    fixture: ReturnType<typeof createFixture>,
    index: number
  ): HTMLButtonElement {
    const button = fixture.nativeElement.querySelectorAll(
      '.community-preview__tabs button'
    ).item(index) as HTMLButtonElement | null;

    if (!button) throw new Error(`Botão comunitário ${index} ausente.`);
    return button;
  }

  it('mantém título único e submenu contextual enxuto', () => {
    const fixture = createFixture();

    expect(fixture.nativeElement.querySelectorAll('h1')).toHaveLength(1);
    expect(
      fixture.nativeElement.querySelectorAll('.community-preview__tabs button')
    ).toHaveLength(3);
    expect(fixture.nativeElement.textContent).toContain('Mural');
    expect(fixture.nativeElement.textContent).toContain('Fotos');
    expect(fixture.nativeElement.textContent).toContain('Sobre');
  });

  it('não repete a descrição no cabeçalho ou mural', () => {
    const fixture = createFixture();

    expect(fixture.nativeElement.textContent).not.toContain(
      'Atualizações e fotos do local.'
    );
  });

  it('mostra descrição e métricas somente em Sobre', () => {
    const fixture = createFixture();

    sectionButton(fixture, 2).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Atualizações e fotos do local.'
    );
    expect(fixture.nativeElement.textContent).toContain('12 membros');
    expect(fixture.nativeElement.textContent).toContain(
      'Interação reservada aos membros'
    );
  });

  it('consulta fotos somente após selecionar a galeria', () => {
    const fixture = createFixture();

    expect(feedRepositoryMock.getPage$).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'feed' })
    );

    sectionButton(fixture, 1).click();
    fixture.detectChanges();

    expect(feedRepositoryMock.getPage$).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'photos' })
    );
  });
});
