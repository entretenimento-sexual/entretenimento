import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ConfirmationDialogComponent } from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import { COMMUNITY_CREATE_RETURN_URL } from 'src/app/subscriptions/domain/subscription-flow-context.model';
import { CommunityCreateRepository } from '../data-access/community-create.repository';
import { CommunityCreationGateService } from './community-creation-gate.service';

function capability(overrides: Record<string, unknown> = {}) {
  return {
    canCreate: true,
    reason: null,
    sponsorRole: 'basic' as const,
    minimumRole: 'basic' as const,
    currentOwnedCommunities: 0,
    maxOwnedCommunities: 1,
    memberLimit: 100 as const,
    allowedMemberLimits: [25, 50, 100] as const,
    generatedAt: 100,
    ...overrides,
  };
}

describe('CommunityCreationGateService', () => {
  const getCreationCapability$ = vi.fn();
  const navigate = vi.fn();
  const dialogOpen = vi.fn();
  const showError = vi.fn();
  const handleError = vi.fn();
  let dialogClosed$: Subject<boolean>;

  beforeEach(() => {
    vi.clearAllMocks();
    dialogClosed$ = new Subject<boolean>();
    getCreationCapability$.mockReturnValue(of(capability()));
    navigate.mockResolvedValue(true);
    dialogOpen.mockReturnValue({
      afterClosed: () => dialogClosed$.asObservable(),
    });

    TestBed.configureTestingModule({
      providers: [
        CommunityCreationGateService,
        {
          provide: CommunityCreateRepository,
          useValue: { getCreationCapability$ },
        },
        {
          provide: Router,
          useValue: { navigate },
        },
        {
          provide: MatDialog,
          useValue: { open: dialogOpen },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showError },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError },
        },
      ],
    });
  });

  it('navega direto para o compositor quando a capability permite criação', async () => {
    const service = TestBed.inject(CommunityCreationGateService);

    await firstValueFrom(service.requestCreation$());

    expect(getCreationCapability$).toHaveBeenCalledTimes(1);
    expect(dialogOpen).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/dashboard/comunidades/nova']);
  });

  it('mantém participação gratuita e oferece Basic antes de abrir o compositor', async () => {
    getCreationCapability$.mockReturnValue(of(capability({
      canCreate: false,
      reason: 'subscription_required',
      sponsorRole: 'free',
      currentOwnedCommunities: 0,
      maxOwnedCommunities: 0,
      memberLimit: 0,
      allowedMemberLimits: [],
    })));
    const service = TestBed.inject(CommunityCreationGateService);
    const request = firstValueFrom(service.requestCreation$());

    expect(dialogOpen).toHaveBeenCalledWith(
      ConfirmationDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          eyebrow: 'Conta Gratuita',
          title: 'Crie sua própria Comunidade',
          confirmLabel: 'Ver planos',
          cancelLabel: 'Continuar explorando',
        }),
      })
    );

    dialogClosed$.next(true);
    await request;

    expect(navigate).toHaveBeenCalledWith(['/subscription-plan'], {
      queryParams: {
        minimumRole: 'basic',
        returnUrl: COMMUNITY_CREATE_RETURN_URL,
      },
    });
  });

  it('oferece Premium quando o Basic atingiu sua cota', async () => {
    getCreationCapability$.mockReturnValue(of(capability({
      canCreate: false,
      reason: 'limit_reached',
      currentOwnedCommunities: 1,
      maxOwnedCommunities: 1,
    })));
    const service = TestBed.inject(CommunityCreationGateService);
    const request = firstValueFrom(service.requestCreation$());

    dialogClosed$.next(true);
    await request;

    expect(navigate).toHaveBeenCalledWith(['/subscription-plan'], {
      queryParams: {
        minimumRole: 'premium',
        returnUrl: COMMUNITY_CREATE_RETURN_URL,
      },
    });
  });

  it('direciona VIP sem upgrade disponível para a gestão das Comunidades', async () => {
    getCreationCapability$.mockReturnValue(of(capability({
      canCreate: false,
      reason: 'limit_reached',
      sponsorRole: 'vip',
      currentOwnedCommunities: 5,
      maxOwnedCommunities: 5,
      memberLimit: 500,
      allowedMemberLimits: [25, 50, 100, 250, 500],
    })));
    const service = TestBed.inject(CommunityCreationGateService);
    const request = firstValueFrom(service.requestCreation$());

    dialogClosed$.next(true);
    await request;

    expect(navigate).toHaveBeenCalledWith(['/dashboard/comunidades/minhas']);
  });

  it('falha fechado com feedback e diagnóstico quando a capability não responde', async () => {
    getCreationCapability$.mockReturnValue(
      throwError(() => new Error('capability unavailable'))
    );
    const service = TestBed.inject(CommunityCreationGateService);

    await firstValueFrom(service.requestCreation$());

    expect(navigate).not.toHaveBeenCalled();
    expect(dialogOpen).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(
      'Não foi possível verificar a criação de Comunidades agora.'
    );
    expect(handleError).toHaveBeenCalled();
  });
});
