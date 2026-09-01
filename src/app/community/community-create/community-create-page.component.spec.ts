// src/app/community/community-create/community-create-page.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter, Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ConfirmationDialogComponent } from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import { COMMUNITY_CREATE_RETURN_URL } from 'src/app/subscriptions/domain/subscription-flow-context.model';
import { CommunityCreateRepository } from '../data-access/community-create.repository';
import { CommunityTagRepository } from '../data-access/community-tag.repository';
import { CommunityCreatePageComponent } from './community-create-page.component';

const TAG_CATALOG = [
  { id: 'intent:friendship', label: 'Amizade', category: 'intent' as const },
  { id: 'intent:casual', label: 'Casual', category: 'intent' as const },
  { id: 'practice:bdsm', label: 'BDSM', category: 'practice' as const },
  { id: 'practice:tantra', label: 'Tantra', category: 'practice' as const },
  { id: 'audience:men', label: 'Homens', category: 'audience' as const },
  { id: 'audience:women', label: 'Mulheres', category: 'audience' as const },
  { id: 'audience:couple_mf', label: 'Casal MF', category: 'audience' as const },
] as const;

const BASIC_CAPACITY_OPTIONS = [
  { memberLimit: 25, requirement: 'basic', allowed: true },
  { memberLimit: 50, requirement: 'basic', allowed: true },
  { memberLimit: 100, requirement: 'basic', allowed: true },
  { memberLimit: 250, requirement: 'premium', allowed: false },
  { memberLimit: 500, requirement: 'vip', allowed: false },
  { memberLimit: 1_000, requirement: 'special_access', allowed: false },
] as const;

function creationCapability(overrides: Record<string, unknown> = {}) {
  return {
    canCreate: true,
    reason: null,
    sponsorRole: 'basic' as const,
    minimumRole: 'basic' as const,
    recommendedUpgradeRole: null,
    currentOwnedCommunities: 0,
    maxOwnedCommunities: 1,
    memberLimit: 100,
    memberLimitOptions: BASIC_CAPACITY_OPTIONS,
    allowedMemberLimits: [25, 50, 100] as const,
    generatedAt: 100,
    ...overrides,
  };
}

describe('CommunityCreatePageComponent', () => {
  const createCommunity$ = vi.fn();
  const getCreationCapability$ = vi.fn();
  const getCommunityTagCatalog$ = vi.fn();
  const showWarning = vi.fn();
  const showSuccess = vi.fn();
  const showError = vi.fn();
  const handleError = vi.fn();
  const dialogOpen = vi.fn();
  let dialogClosed$: Subject<boolean>;

  beforeEach(() => {
    vi.clearAllMocks();
    dialogClosed$ = new Subject<boolean>();
    dialogOpen.mockReturnValue({
      afterClosed: () => dialogClosed$.asObservable(),
    });
    createCommunity$.mockReturnValue(
      of({
        communityId: 'community-created-1',
        created: true,
      })
    );
    getCreationCapability$.mockReturnValue(of(creationCapability()));
    getCommunityTagCatalog$.mockReturnValue(
      of({ items: TAG_CATALOG, generatedAt: Date.now() })
    );

    TestBed.configureTestingModule({
      imports: [CommunityCreatePageComponent],
      providers: [
        provideRouter([]),
        {
          provide: CommunityCreateRepository,
          useValue: { createCommunity$, getCreationCapability$ },
        },
        {
          provide: CommunityTagRepository,
          useValue: { getCommunityTagCatalog$ },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showWarning, showSuccess, showError },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError },
        },
        {
          provide: MatDialog,
          useValue: { open: dialogOpen },
        },
      ],
    });
  });

  function fillValidForm(component: CommunityCreatePageComponent): void {
    component.form.setValue({
      name: 'Comunidade Funcional',
      theme: 'interests',
      description: 'Grupo funcional para validação.',
      rules: 'Respeite a privacidade de todos os participantes.',
      joinPolicy: 'approval',
      memberLimit: 25,
      tagIds: ['intent:friendship'],
    });
  }

  it('bloqueia envio inválido e apresenta feedback', () => {
    const fixture = TestBed.createComponent(CommunityCreatePageComponent);
    fixture.detectChanges();

    fixture.componentInstance.submit();

    expect(createCommunity$).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledWith(
      'Revise os campos obrigatórios da Comunidade.'
    );
  });

  it('inicializa a capacidade pela primeira opção liberada pelo backend', () => {
    getCreationCapability$.mockReturnValue(of(creationCapability({
      memberLimit: 80,
      memberLimitOptions: [
        { memberLimit: 40, requirement: 'basic', allowed: true },
        { memberLimit: 80, requirement: 'basic', allowed: true },
        { memberLimit: 160, requirement: 'premium', allowed: false },
      ],
      allowedMemberLimits: [40, 80],
    })));
    const fixture = TestBed.createComponent(CommunityCreatePageComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.form.controls.memberLimit.value).toBe(40);
    expect(
      fixture.nativeElement.querySelectorAll(
        '.community-create__capacity-options button'
      )
    ).toHaveLength(3);
  });

  it('seleciona e remove tags pelo controle reativo', () => {
    const fixture = TestBed.createComponent(CommunityCreatePageComponent);
    const component = fixture.componentInstance;

    component.toggleTag('intent:friendship');
    component.toggleTag('practice:bdsm');

    expect(component.form.controls.tagIds.value).toEqual([
      'intent:friendship',
      'practice:bdsm',
    ]);
    expect(component.isTagSelected('practice:bdsm')).toBe(true);

    component.toggleTag('intent:friendship');

    expect(component.form.controls.tagIds.value).toEqual(['practice:bdsm']);
    expect(component.isTagSelected('intent:friendship')).toBe(false);
  });

  it('impede selecionar mais de seis tags e mantém feedback explícito', () => {
    const fixture = TestBed.createComponent(CommunityCreatePageComponent);
    const component = fixture.componentInstance;

    for (const tag of TAG_CATALOG.slice(0, 6)) {
      component.toggleTag(tag.id);
    }
    component.toggleTag(TAG_CATALOG[6].id);

    expect(component.form.controls.tagIds.value).toHaveLength(6);
    expect(showWarning).toHaveBeenCalledWith(
      'Escolha no máximo 6 interesses para manter a Comunidade bem definida.'
    );
  });

  it('cria a Comunidade e navega para o detalhe canônico', () => {
    const fixture = TestBed.createComponent(CommunityCreatePageComponent);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const component = fixture.componentInstance;
    fillValidForm(component);

    component.submit();

    expect(createCommunity$).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.any(String),
        name: 'Comunidade Funcional',
        theme: 'interests',
        description: 'Grupo funcional para validação.',
        rules: 'Respeite a privacidade de todos os participantes.',
        joinPolicy: 'approval',
        memberLimit: 25,
        tagIds: ['intent:friendship'],
      })
    );
    expect(showSuccess).toHaveBeenCalledWith('Comunidade criada.');
    expect(navigate).toHaveBeenCalledWith([
      '/dashboard/comunidades',
      'community-created-1',
    ]);
  });

  it('orienta o Gratuito por modal e encaminha para o plano recomendado', () => {
    getCreationCapability$.mockReturnValue(of(creationCapability({
      canCreate: false,
      reason: 'subscription_required',
      sponsorRole: 'free',
      recommendedUpgradeRole: 'basic',
      currentOwnedCommunities: 0,
      maxOwnedCommunities: 0,
      memberLimit: 0,
      memberLimitOptions: BASIC_CAPACITY_OPTIONS.map((option) => ({
        ...option,
        allowed: false,
      })),
      allowedMemberLimits: [],
    })));
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CommunityCreatePageComponent);
    fixture.detectChanges();

    expect(createCommunity$).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'Pertencer continua gratuito'
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Conhecer o plano Basic'
    );
    expect(dialogOpen).toHaveBeenCalledWith(
      ConfirmationDialogComponent,
      expect.objectContaining({
        disableClose: false,
        restoreFocus: false,
        data: expect.objectContaining({
          eyebrow: 'Conta Gratuita',
          title: 'Crie sua própria Comunidade',
          confirmLabel: 'Ver planos',
          cancelLabel: 'Continuar explorando',
        }),
      })
    );

    dialogClosed$.next(true);

    expect(navigate).toHaveBeenCalledWith(['/subscription-plan'], {
      queryParams: {
        minimumRole: 'basic',
        returnUrl: COMMUNITY_CREATE_RETURN_URL,
      },
    });
  });

  it('oferece o plano superior recomendado quando a cota foi atingida', () => {
    getCreationCapability$.mockReturnValue(of(creationCapability({
      canCreate: false,
      reason: 'limit_reached',
      sponsorRole: 'basic',
      recommendedUpgradeRole: 'premium',
      currentOwnedCommunities: 1,
      maxOwnedCommunities: 1,
    })));
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    TestBed.createComponent(CommunityCreatePageComponent).detectChanges();

    expect(dialogOpen).toHaveBeenCalledWith(
      ConfirmationDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Você atingiu o limite de Comunidades',
          confirmLabel: 'Comparar planos',
          cancelLabel: 'Gerenciar Comunidades',
        }),
      })
    );

    dialogClosed$.next(true);

    expect(navigate).toHaveBeenCalledWith(['/subscription-plan'], {
      queryParams: {
        minimumRole: 'premium',
        returnUrl: COMMUNITY_CREATE_RETURN_URL,
      },
    });
  });

  it('mantém capacidades superiores visíveis sem concedê-las no frontend', () => {
    const fixture = TestBed.createComponent(CommunityCreatePageComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const premiumOption = BASIC_CAPACITY_OPTIONS.find(
      (option) => option.memberLimit === 250
    );

    expect(premiumOption).toBeDefined();
    component.selectMemberLimit(premiumOption!);

    expect(component.form.controls.memberLimit.value).toBe(25);
    expect(showWarning).toHaveBeenCalledWith(
      'Premium é necessário para escolher essa capacidade.'
    );
    expect(
      fixture.nativeElement.querySelectorAll(
        '.community-create__capacity-options button'
      )
    ).toHaveLength(BASIC_CAPACITY_OPTIONS.length);
  });

  it('mantém feedback e diagnóstico centralizado quando o perfil está incompleto', () => {
    createCommunity$.mockReturnValue(
      throwError(() => ({
        code: 'functions/failed-precondition',
        details: {
          reason: 'profile_incomplete',
          recommendedAction: 'complete_profile',
        },
      }))
    );

    const fixture = TestBed.createComponent(CommunityCreatePageComponent);
    const component = fixture.componentInstance;
    fillValidForm(component);

    component.submit();

    expect(showError).toHaveBeenCalledWith(
      'Complete seu perfil antes de criar uma Comunidade.'
    );
    expect(handleError).toHaveBeenCalled();
  });

  it('falha fechado quando a capability não pode ser verificada', () => {
    getCreationCapability$.mockReturnValue(
      throwError(() => new Error('capability unavailable'))
    );
    const fixture = TestBed.createComponent(CommunityCreatePageComponent);
    fixture.detectChanges();

    expect(showError).toHaveBeenCalledWith(
      'Não foi possível verificar a criação de Comunidades agora.'
    );
    expect(handleError).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Tentar novamente');
    expect(dialogOpen).not.toHaveBeenCalled();
  });
});