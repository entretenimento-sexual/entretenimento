import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PhotoEditorLauncherService } from 'src/app/core/services/image-handling/photo-editor-launcher.service';
import { ConfirmationDialogComponent } from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import { CommunityPreviewCard } from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { provideCommunityFeedCacheTestDouble } from '../feed/community-feed-cache.testing';
import { CommunityPreviewPageComponent } from './community-preview-page.component';

describe('CommunityPreviewPageComponent / confirmação de saída', () => {
  const dialogMock = { open: vi.fn() };
  const membershipRepositoryMock = {
    requestMembership$: vi.fn(),
    leaveMembership$: vi.fn(),
    getMembershipRequests$: vi.fn(),
    reviewMembership$: vi.fn(),
  };
  const previewRepositoryMock = { getPreview$: vi.fn() };
  const feedRepositoryMock = {
    getPage$: vi.fn(),
    getItems$: vi.fn(),
    watchLatestChanges$: vi.fn(),
  };
  const photoEditorMock = {
    editFile$: vi.fn(() => of(null)),
  };
  const notifierMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
  };
  const accessNavigationMock = { navigateForDecision: vi.fn() };

  const community: CommunityPreviewCard = {
    communityId: 'community-bdsm-brasil',
    name: 'BDSM Brasil',
    slug: 'bdsm-brasil',
    description: 'Comunidade de teste.',
    source: { type: 'community', id: 'community-bdsm-brasil' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 10, postCount: 2, mediaCount: 1 },
    access: {
      join: 'approval',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    membershipRepositoryMock.leaveMembership$.mockReturnValue(
      of({ status: 'left', viewerMode: 'visitor', canInteract: false })
    );
    previewRepositoryMock.getPreview$.mockReturnValue(
      of({
        community,
        viewerMode: 'moderator',
        viewerRole: 'moderator',
        canInteract: true,
        canManageMemberships: true,
        canInviteCommunityMembers: false,
        canManageCommunitySettings: false,
        settings: null,
        canLeaveMembership: true,
        generatedAt: 1,
      })
    );
    feedRepositoryMock.getPage$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: 1 })
    );
    feedRepositoryMock.getItems$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: 1 })
    );
    feedRepositoryMock.watchLatestChanges$.mockReturnValue(of([]));
    accessNavigationMock.navigateForDecision.mockResolvedValue(true);

    TestBed.configureTestingModule({
      imports: [CommunityPreviewPageComponent],
      providers: [
        provideRouter([]),
        provideCommunityFeedCacheTestDouble(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: { backRoute: '/dashboard/comunidades' } },
            paramMap: of(
              convertToParamMap({ communityId: 'community-bdsm-brasil' })
            ),
          },
        },
        { provide: MatDialog, useValue: dialogMock },
        { provide: CommunityPreviewRepository, useValue: previewRepositoryMock },
        { provide: CommunityFeedRepository, useValue: feedRepositoryMock },
        { provide: CommunityMembershipRepository, useValue: membershipRepositoryMock },
        { provide: PhotoEditorLauncherService, useValue: photoEditorMock },
        { provide: ContentAccessNavigationService, useValue: accessNavigationMock },
        { provide: ErrorNotificationService, useValue: notifierMock },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('não chama a callable quando a saída é cancelada', () => {
    dialogMock.open.mockReturnValue({ afterClosed: () => of(false) });
    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    const subscription = fixture.componentInstance.membershipAction$.subscribe();

    fixture.componentInstance.leaveMembership(
      community,
      'moderator',
      'moderator'
    );

    expect(dialogMock.open).toHaveBeenCalledWith(
      ConfirmationDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Sair da Comunidade?',
          confirmLabel: 'Sair da Comunidade',
          cancelLabel: 'Continuar na Moderação',
          tone: 'danger',
        }),
      })
    );
    expect(membershipRepositoryMock.leaveMembership$).not.toHaveBeenCalled();

    subscription.unsubscribe();
  });

  it('explica perda de Moderação e só sai após confirmação explícita', () => {
    dialogMock.open.mockReturnValue({ afterClosed: () => of(true) });
    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    const subscription = fixture.componentInstance.membershipAction$.subscribe();

    fixture.componentInstance.leaveMembership(
      community,
      'moderator',
      'moderator'
    );

    const options = dialogMock.open.mock.calls[0]?.[1] as {
      data?: { message?: string; detail?: string };
    };

    expect(options.data?.message).toContain('papel de Moderação');
    expect(options.data?.detail).toContain('não será restaurada automaticamente');
    expect(membershipRepositoryMock.leaveMembership$).toHaveBeenCalledWith(
      'community-bdsm-brasil'
    );
    expect(notifierMock.showSuccess).toHaveBeenCalledWith(
      'Você saiu da Comunidade.'
    );

    subscription.unsubscribe();
  });

  it('explica perda de Administração antes de sair', () => {
    dialogMock.open.mockReturnValue({ afterClosed: () => of(false) });
    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    const subscription = fixture.componentInstance.membershipAction$.subscribe();

    fixture.componentInstance.leaveMembership(community, 'manager', 'admin');

    const options = dialogMock.open.mock.calls[0]?.[1] as {
      data?: { message?: string; detail?: string; cancelLabel?: string };
    };

    expect(options.data?.message).toContain('papel de Administração');
    expect(options.data?.detail).toContain('não será restaurada automaticamente');
    expect(options.data?.cancelLabel).toBe('Continuar na Administração');
    expect(membershipRepositoryMock.leaveMembership$).not.toHaveBeenCalled();

    subscription.unsubscribe();
  });

  it('explica liberação da propriedade para owner em estado terminal', () => {
    dialogMock.open.mockReturnValue({ afterClosed: () => of(false) });
    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    const subscription = fixture.componentInstance.membershipAction$.subscribe();

    fixture.componentInstance.leaveMembership(community, 'manager', 'owner');

    const options = dialogMock.open.mock.calls[0]?.[1] as {
      data?: {
        title?: string;
        message?: string;
        detail?: string;
        confirmLabel?: string;
      };
    };

    expect(options.data?.title).toBe('Encerrar seu vínculo com a Comunidade?');
    expect(options.data?.message).toContain('propriedade será liberada');
    expect(options.data?.detail).toContain('nem transfere a propriedade');
    expect(options.data?.confirmLabel).toBe('Liberar propriedade e sair');
    expect(membershipRepositoryMock.leaveMembership$).not.toHaveBeenCalled();

    subscription.unsubscribe();
  });

  it('renderiza saída para Administração somente quando o backend autoriza', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of({
        community,
        viewerMode: 'manager',
        viewerRole: 'admin',
        canInteract: true,
        canManageMemberships: true,
        canInviteCommunityMembers: false,
        canManageCommunitySettings: false,
        settings: null,
        canLeaveMembership: true,
        generatedAt: 1,
      })
    );

    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    const leave = fixture.nativeElement.querySelector(
      '.community-preview__membership-leave-action'
    ) as HTMLButtonElement | null;

    expect(leave).not.toBeNull();
    expect(leave?.textContent).toContain('Sair');
  });

  it('não infere saída para owner operacional quando capability é falsa', () => {
    previewRepositoryMock.getPreview$.mockReturnValue(
      of({
        community,
        viewerMode: 'manager',
        viewerRole: 'owner',
        canInteract: true,
        canManageMemberships: true,
        canInviteCommunityMembers: false,
        canManageCommunitySettings: false,
        settings: null,
        canLeaveMembership: false,
        generatedAt: 1,
      })
    );

    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.community-preview__membership-leave-action')
    ).toBeNull();
  });

  it('mantém cancelamento de solicitação pendente sem modal destrutivo', () => {
    const fixture = TestBed.createComponent(CommunityPreviewPageComponent);
    const subscription = fixture.componentInstance.membershipAction$.subscribe();

    fixture.componentInstance.leaveMembership(community, 'pending', 'member');

    expect(dialogMock.open).not.toHaveBeenCalled();
    expect(membershipRepositoryMock.leaveMembership$).toHaveBeenCalledWith(
      'community-bdsm-brasil'
    );
    expect(notifierMock.showSuccess).toHaveBeenCalledWith(
      'Solicitação cancelada.'
    );

    subscription.unsubscribe();
  });
});
