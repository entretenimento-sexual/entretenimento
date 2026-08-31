import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import type { CommunityPreviewResponse } from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityPreviewPageComponent } from './community-preview-page.component';

function preview(): CommunityPreviewResponse {
  return {
    community: {
      communityId: 'community-1',
      name: 'Comunidade Teste',
      slug: 'comunidade-teste',
      description: 'Comunidade para validar navegação.',
      source: { type: 'community', id: 'community-1' },
      avatarUrl: null,
      coverUrl: null,
      metrics: { memberCount: 12, postCount: 4, mediaCount: 2 },
      access: {
        join: 'approval',
        minimumRole: null,
        requiresActiveSubscription: false,
      },
      tags: [],
    },
    rules: null,
    lifecycleStatus: 'active',
    viewerMode: 'visitor',
    viewerRole: null,
    canInteract: false,
    canManageMemberships: false,
    canInviteCommunityMembers: false,
    canManageCommunitySettings: false,
    capacity: {
      configuredLimit: 25,
      effectiveLimit: 25,
      memberCount: 12,
      acceptingNewMembers: true,
      restrictedByOwnerPlan: false,
      allowedMemberLimits: [],
    },
    settings: null,
    canLeaveMembership: false,
    generatedAt: 123,
  };
}

describe('CommunityPreviewPageComponent / navegação e retry', () => {
  let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const getPreview$ = vi.fn();
  const navigate = vi.fn();
  const showError = vi.fn();
  const handleError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    queryParamMap$ = new BehaviorSubject(convertToParamMap({}));
    getPreview$.mockReturnValue(of(preview()));
    navigate.mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: { backRoute: '/dashboard/comunidades' },
              queryParamMap: convertToParamMap({}),
            },
            paramMap: of(convertToParamMap({ communityId: 'community-1' })),
            queryParamMap: queryParamMap$.asObservable(),
          },
        },
        { provide: Router, useValue: { navigate } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: CommunityPreviewRepository, useValue: { getPreview$ } },
        {
          provide: CommunityMembershipRepository,
          useValue: {
            requestMembership$: vi.fn(),
            leaveMembership$: vi.fn(),
          },
        },
        {
          provide: ContentAccessNavigationService,
          useValue: { navigateForDecision: vi.fn().mockResolvedValue(true) },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showError, showSuccess: vi.fn() },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError },
        },
      ],
    });
  });

  function createComponent(): CommunityPreviewPageComponent {
    return TestBed.runInInjectionContext(
      () => new CommunityPreviewPageComponent()
    );
  }

  it('redireciona a seção legada de tópicos para o Mural e preserva retorno', () => {
    queryParamMap$.next(
      convertToParamMap({
        secao: 'topicos',
        retorno: '/dashboard/comunidades?interesse=practice:bdsm',
      })
    );

    const component = createComponent();

    expect(component.activeSection()).toBe('feed');
    expect(component.returnTarget()).toBe(
      '/dashboard/comunidades?interesse=practice:bdsm'
    );
    expect(navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { secao: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    navigate.mockClear();
    component.selectSection('photos');

    expect(component.activeSection()).toBe('photos');
    expect(navigate).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: { secao: 'fotos' },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });

    queryParamMap$.next(
      convertToParamMap({
        secao: 'sobre',
        retorno: '/dashboard/comunidades?interesse=practice:bdsm',
      })
    );
    expect(component.activeSection()).toBe('about');
  });

  it('rejeita retorno externo e mantém a rota canônica de fallback', () => {
    queryParamMap$.next(
      convertToParamMap({ retorno: 'https://example.test/fora' })
    );

    const component = createComponent();

    expect(component.returnTarget()).toBe('/dashboard/comunidades');
  });

  it('mantém state$ reativo após falha e permite retry sem snackbar duplicado', () => {
    getPreview$
      .mockReturnValueOnce(throwError(() => new Error('falha transitória')))
      .mockReturnValueOnce(of(preview()));

    const component = createComponent();
    const statuses: string[] = [];
    const subscription = component.state$.subscribe((state) =>
      statuses.push(state.status)
    );

    expect(statuses.at(-1)).toBe('error');
    expect(showError).not.toHaveBeenCalled();
    expect(handleError).toHaveBeenCalledTimes(1);

    component.retryPreview();

    expect(statuses.at(-1)).toBe('ready');
    expect(getPreview$).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });
});
