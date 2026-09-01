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

const BASIC_OPTIONS = [
  { memberLimit: 25, requirement: 'basic', allowed: true },
  { memberLimit: 50, requirement: 'basic', allowed: true },
  { memberLimit: 100, requirement: 'basic', allowed: true },
  { memberLimit: 250, requirement: 'premium', allowed: false },
  { memberLimit: 500, requirement: 'vip', allowed: false },
  { memberLimit: 1_000, requirement: 'special_access', allowed: false },
] as const;

function capability(overrides: Record<string, unknown> = {}) {
  return {
    canCreate: true,
    reason: null,
    sponsorRole: 'basic' as const,
    minimumRole: 'basic' as const,
    recommendedUpgradeRole: null,
    currentOwnedCommunities: 0,
    maxOwnedCommunities: 1,
    memberLimit: 100,
    memberLimitOptions: BASIC_OPTIONS,
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

  it('mantém participação gratuita e usa a recomendação Basic do backend', async () => {
    getCreationCapability$.mockReturnValue(of(capability({
      canCreate: false,
      reason: 'subscription_required',
      sponsorRole: 'free',
      recommendedUpgradeRole: 'basic',
      currentOwnedCommunities: 0,
      maxOwnedCommunities: 0,
      memberLimit: 0,
      memberLimitOptions: BASIC_OPTIONS.map((option) => ({
        ...option,
        allowed: false,
      })),
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
          detail: expect.not.stringContaining('100'),
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

  it('trata assinatura inativa com Comunidade existente como regularização', async () => {
    getCreationCapability$.mockReturnValue(of(capability({
      canCreate: false,
      reason: 'subscription_required',
      sponsorRole: 'free',
      recommendedUpgradeRole: 'basic',
      currentOwnedCommunities: 2,
      maxOwnedCommunities: 0,
      memberLimit: 0,
      memberLimitOptions: BASIC_OPTIONS.map((option) => ({
        ...option,
        allowed: false,
      })),
      allowedMemberLimits: [],
    })));
    const service = TestBed.inject(CommunityCreationGateService);
    const request = firstValueFrom(service.requestCreation$());

    expect(dialogOpen).toHaveBeenCalledWith(
      ConfirmationDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          eyebrow: 'Regularização de Comunidades',
          title: 'Seu plano atual não cobre suas Comunidades',
          confirmLabel: 'Regularizar plano',
          cancelLabel: 'Gerenciar Comunidades',
          message: expect.stringContaining('Nenhuma Comunidade ou membro será removido automaticamente'),
        }),
      })
    );

    dialogClosed$.next(false);
    await request;

    expect(navigate).toHaveBeenCalledWith(['/dashboard/comunidades/minhas']);
  });

  it('oferece Premium somente quando a capability recomenda Premium', async () => {
    getCreationCapability$.mockReturnValue(of(capability({
      canCreate: false,
      reason: 'limit_reached',
      recommendedUpgradeRole: 'premium',
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

  it('distingue downgrade acima da quota de apenas atingir o limite', async () => {
    getCreationCapability$.mockReturnValue(of(capability({
      canCreate: false,
      reason: 'limit_reached',
      sponsorRole: 'basic',
      recommendedUpgradeRole: 'premium',
      currentOwnedCommunities: 3,
      maxOwnedCommunities: 1,
    })));
    const service = TestBed.inject(CommunityCreationGateService);
    const request = firstValueFrom(service.requestCreation$());

    expect(dialogOpen).toHaveBeenCalledWith(
      ConfirmationDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          eyebrow: 'Regularização de Comunidades',
          title: 'Seu plano mudou e excede o limite atual',
          message: expect.stringContaining('Nenhuma será excluída automaticamente'),
          confirmLabel: 'Regularizar plano',
          cancelLabel: 'Gerenciar Comunidades',
        }),
      })
    );

    dialogClosed$.next(true);
    await request;

    expect(navigate).toHaveBeenCalledWith(['/subscription-plan'], {
      queryParams: {
        minimumRole: 'premium',
        returnUrl: COMMUNITY_CREATE_RETURN_URL,
      },
    });
  });

  it('não infere upgrade quando o backend não recomenda outro plano', async () => {
    getCreationCapability$.mockReturnValue(of(capability({
      canCreate: false,
      reason: 'limit_reached',
      recommendedUpgradeRole: null,
      currentOwnedCommunities: 1,
      maxOwnedCommunities: 1,
    })));
    const service = TestBed.inject(CommunityCreationGateService);
    const request = firstValueFrom(service.requestCreation$());

    dialogClosed$.next(true);
    await request;

    expect(navigate).toHaveBeenCalledWith(['/dashboard/comunidades/minhas']);
    expect(navigate).not.toHaveBeenCalledWith(
      ['/subscription-plan'],
      expect.anything()
    );
  });

  it('direciona VIP sem upgrade disponível para a gestão das Comunidades', async () => {
    getCreationCapability$.mockReturnValue(of(capability({
      canCreate: false,
      reason: 'limit_reached',
      sponsorRole: 'vip',
      recommendedUpgradeRole: null,
      currentOwnedCommunities: 5,
      maxOwnedCommunities: 5,
      memberLimit: 500,
      memberLimitOptions: BASIC_OPTIONS.map((option) => ({
        ...option,
        allowed: option.memberLimit <= 500,
      })),
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
