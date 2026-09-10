// src/app/community/profile-my-communities/profile-my-communities.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityNotificationPreferenceService } from 'src/app/core/services/notifications/community-notification-preference.service';
import { CommunityNotificationUnreadSummaryService } from 'src/app/core/services/notifications/community-notification-unread-summary.service';
import { CommunityPreviewCard } from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityDiscoveryCacheService } from '../discovery/community-discovery-cache.service';
import { ProfileMyCommunitiesComponent } from './profile-my-communities.component';

function communityCard(
  communityId: string,
  viewerRole: CommunityPreviewCard['viewerRole'] = 'member'
): CommunityPreviewCard {
  return {
    communityId,
    name: `Comunidade ${communityId}`,
    slug: communityId,
    description: null,
    source: { type: 'community', id: communityId },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 12, postCount: 3, mediaCount: 1 },
    access: {
      join: 'open',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: [],
    viewerRole,
  };
}

describe('ProfileMyCommunitiesComponent', () => {
  let fixture: ComponentFixture<ProfileMyCommunitiesComponent>;
  const readSnapshot$ = vi.fn();
  const rememberPage = vi.fn();
  const getMyCommunitiesPage$ = vi.fn();
  const report = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    readSnapshot$.mockReturnValue(of(null));
    getMyCommunitiesPage$.mockReturnValue(
      of({
        items: [communityCard('community-1', 'owner')],
        nextCursor: null,
        generatedAt: 200,
      })
    );

    await TestBed.configureTestingModule({
      imports: [ProfileMyCommunitiesComponent],
      providers: [
        provideRouter([]),
        {
          provide: CommunityPreviewRepository,
          useValue: { getMyCommunitiesPage$ },
        },
        {
          provide: CommunityDiscoveryCacheService,
          useValue: { readSnapshot$, rememberPage },
        },
        {
          provide: ApplicationErrorService,
          useValue: { report },
        },
        {
          provide: CommunityNotificationUnreadSummaryService,
          useValue: {
            currentUserSummaryMap$: of(new Map([
              [
                'community-1',
                {
                  communityId: 'community-1',
                  unreadCount: 7,
                  hasPriorityUnread: true,
                },
              ],
            ])),
          },
        },
        {
          provide: CommunityNotificationPreferenceService,
          useValue: {
            currentUserMutedCommunityIds$: of(new Set(['community-1'])),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileMyCommunitiesComponent);
  });

  it('reaproveita o cache resumido fresco sem nova chamada ao backend', () => {
    readSnapshot$.mockImplementation((context) =>
      of(
        context.pageSize === 4
          ? {
              fresh: true,
              page: {
                items: [communityCard('cached-summary', 'admin')],
                nextCursor: null,
                generatedAt: 300,
              },
            }
          : null
      )
    );

    fixture.detectChanges();

    expect(getMyCommunitiesPage$).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Comunidade cached-summary'
    );
    expect(fixture.nativeElement.textContent).toContain('Administração');
  });

  it('reaproveita o prefixo da página completa fresca e limita o perfil a quatro itens', () => {
    const fullItems = [1, 2, 3, 4, 5].map((index) =>
      communityCard(`full-${index}`)
    );

    readSnapshot$.mockImplementation((context) =>
      of(
        context.pageSize === 12
          ? {
              fresh: true,
              page: {
                items: fullItems,
                nextCursor: 'full-5',
                generatedAt: 400,
              },
            }
          : null
      )
    );

    fixture.detectChanges();

    expect(getMyCommunitiesPage$).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Comunidade full-1');
    expect(fixture.nativeElement.textContent).toContain('Comunidade full-4');
    expect(fixture.nativeElement.textContent).not.toContain('Comunidade full-5');
  });

  it('consulta somente quatro comunidades quando não há cache e memoriza a resposta', () => {
    fixture.detectChanges();

    expect(getMyCommunitiesPage$).toHaveBeenCalledWith({
      limit: 4,
      cursor: null,
      sourceType: 'community',
    });
    expect(rememberPage).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'community',
        discoveryMode: 'mine',
        pageSize: 4,
      }),
      expect.objectContaining({ generatedAt: 200 }),
      false
    );
    expect(fixture.nativeElement.textContent).toContain('Proprietário');
    expect(fixture.nativeElement.textContent).toContain('Ver todas');
  });

  it('exibe unread e mute como estados separados da mesma Comunidade', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('7');
    expect(fixture.nativeElement.textContent).toContain('Silenciada');
  });

  it('mantém o cache vencido visível se a revalidação falhar e reporta sem novo aviso', () => {
    readSnapshot$.mockImplementation((context) =>
      of(
        context.pageSize === 4
          ? {
              fresh: false,
              page: {
                items: [communityCard('stale-community')],
                nextCursor: null,
                generatedAt: 100,
              },
            }
          : null
      )
    );
    getMyCommunitiesPage$.mockReturnValue(
      throwError(() => new Error('network down'))
    );

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Comunidade stale-community'
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Atualizando suas comunidades em segundo plano.'
    );
    expect(report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        operation: 'loadProfileMyCommunities',
        notification: 'none',
      })
    );
  });
});
