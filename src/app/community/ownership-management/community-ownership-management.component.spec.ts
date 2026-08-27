import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ConfirmationDialogComponent } from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import { CommunityOwnershipCandidate } from '../data-access/community-ownership.model';
import { CommunityOwnershipRepository } from '../data-access/community-ownership.repository';
import { CommunityOwnershipManagementComponent } from './community-ownership-management.component';

describe('CommunityOwnershipManagementComponent', () => {
  const dialogMock = { open: vi.fn() };
  const repositoryMock = {
    getCandidates$: vi.fn(),
    transferOwnership$: vi.fn(),
    archiveCommunity$: vi.fn(),
  };
  const notifierMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
  };
  const globalErrorMock = { handleError: vi.fn() };
  const routerMock = { navigateByUrl: vi.fn() };

  const candidate: CommunityOwnershipCandidate = {
    uid: 'member-1',
    label: 'Pessoa Um',
    avatarUrl: null,
    role: 'admin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.getCandidates$.mockReturnValue(
      of({ items: [candidate], generatedAt: 1 })
    );
    repositoryMock.transferOwnership$.mockReturnValue(
      of({
        communityId: 'community-1',
        status: 'transferred',
        previousOwnerUid: 'owner-1',
        newOwnerUid: candidate.uid,
        generatedAt: 2,
      })
    );
    repositoryMock.archiveCommunity$.mockReturnValue(
      of({ communityId: 'community-1', status: 'archived', generatedAt: 3 })
    );
    routerMock.navigateByUrl.mockResolvedValue(true);

    TestBed.configureTestingModule({
      imports: [CommunityOwnershipManagementComponent],
      providers: [
        { provide: MatDialog, useValue: dialogMock },
        { provide: Router, useValue: routerMock },
        { provide: CommunityOwnershipRepository, useValue: repositoryMock },
        { provide: ErrorNotificationService, useValue: notifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(CommunityOwnershipManagementComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    return fixture.componentInstance;
  }

  it('não transfere propriedade quando o diálogo é cancelado', () => {
    dialogMock.open.mockReturnValue({ afterClosed: () => of(false) });
    const component = createComponent();
    const subscription = component.action$.subscribe();

    component.requestTransfer(candidate);

    expect(dialogMock.open).toHaveBeenCalledWith(
      ConfirmationDialogComponent,
      expect.objectContaining({
        restoreFocus: true,
        data: expect.objectContaining({
          title: 'Transferir propriedade para Pessoa Um?',
          confirmLabel: 'Transferir propriedade',
          tone: 'warning',
        }),
      })
    );
    expect(repositoryMock.transferOwnership$).not.toHaveBeenCalled();

    subscription.unsubscribe();
  });

  it('explica a perda de propriedade e transfere somente após confirmação', () => {
    dialogMock.open.mockReturnValue({ afterClosed: () => of(true) });
    const component = createComponent();
    const ownershipChanged = vi.fn();
    const outputSubscription = component.ownershipChanged.subscribe(ownershipChanged);
    const actionSubscription = component.action$.subscribe();

    component.requestTransfer(candidate);

    const options = dialogMock.open.mock.calls[0]?.[1] as {
      data?: { message?: string; detail?: string };
    };
    expect(options.data?.message).toContain('deixará de ser o proprietário');
    expect(options.data?.detail).toContain('continuará como Membro');
    expect(repositoryMock.transferOwnership$).toHaveBeenCalledWith(
      'community-1',
      candidate.uid
    );
    expect(notifierMock.showSuccess).toHaveBeenCalledWith(
      'A propriedade foi transferida para Pessoa Um.'
    );
    expect(ownershipChanged).toHaveBeenCalledTimes(1);

    outputSubscription.unsubscribe();
    actionSubscription.unsubscribe();
  });

  it('trata arquivamento como ação destrutiva e não executa ao cancelar', () => {
    dialogMock.open.mockReturnValue({ afterClosed: () => of(false) });
    const component = createComponent();
    const subscription = component.action$.subscribe();

    component.requestArchive();

    expect(dialogMock.open).toHaveBeenCalledWith(
      ConfirmationDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Arquivar esta Comunidade?',
          confirmLabel: 'Arquivar Comunidade',
          tone: 'danger',
          detail: expect.stringContaining('restauração não está disponível'),
        }),
      })
    );
    expect(repositoryMock.archiveCommunity$).not.toHaveBeenCalled();

    subscription.unsubscribe();
  });

  it('arquiva somente após confirmação e retorna à lista de Comunidades', () => {
    dialogMock.open.mockReturnValue({ afterClosed: () => of(true) });
    const component = createComponent();
    const archived = vi.fn();
    const outputSubscription = component.communityArchived.subscribe(archived);
    const actionSubscription = component.action$.subscribe();

    component.requestArchive();

    expect(repositoryMock.archiveCommunity$).toHaveBeenCalledWith(
      'community-1',
      'Arquivamento solicitado pelo proprietário.'
    );
    expect(notifierMock.showSuccess).toHaveBeenCalledWith(
      'Comunidade arquivada com segurança.'
    );
    expect(archived).toHaveBeenCalledTimes(1);
    expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/dashboard/comunidades');

    outputSubscription.unsubscribe();
    actionSubscription.unsubscribe();
  });

  it('traduz exigência de autenticação recente sem perder diagnóstico centralizado', () => {
    dialogMock.open.mockReturnValue({ afterClosed: () => of(true) });
    repositoryMock.transferOwnership$.mockReturnValue(
      throwError(() => ({
        code: 'functions/failed-precondition',
        details: { reason: 'recent-authentication-required' },
      }))
    );
    const component = createComponent();
    const subscription = component.action$.subscribe();

    component.requestTransfer(candidate);

    expect(notifierMock.showError).toHaveBeenCalledWith(
      'Por segurança, saia e entre novamente antes de confirmar esta ação.'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);

    subscription.unsubscribe();
  });
});
