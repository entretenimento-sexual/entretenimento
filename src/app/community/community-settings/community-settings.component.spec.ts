import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityEditableSettings } from '../data-access/community-settings.model';
import { CommunityCapacityPreview } from '../data-access/community-capacity.model';
import { CommunitySettingsRepository } from '../data-access/community-settings.repository';
import { CommunityTagRepository } from '../data-access/community-tag.repository';
import { CommunitySettingsComponent } from './community-settings.component';

const SETTINGS: CommunityEditableSettings = {
  name: 'Comunidade Segura',
  description: 'Pessoas com interesses em comum.',
  rules: 'Respeite todos os participantes.',
  joinPolicy: 'approval',
  membersCanInvite: false,
  memberLimit: 25,
  tagIds: ['intent:friendship'],
};

const CAPACITY_OPTIONS = [
  { memberLimit: 25, requirement: 'basic', allowed: true },
  { memberLimit: 50, requirement: 'basic', allowed: true },
  { memberLimit: 100, requirement: 'basic', allowed: true },
  { memberLimit: 250, requirement: 'premium', allowed: false },
] as const;

const CAPACITY: CommunityCapacityPreview = {
  configuredLimit: 25,
  effectiveLimit: 25,
  memberCount: 8,
  acceptingNewMembers: true,
  restrictedByOwnerPlan: false,
  memberLimitOptions: CAPACITY_OPTIONS,
  allowedMemberLimits: [25, 50, 100],
};

describe('CommunitySettingsComponent', () => {
  const repositoryMock = { updateSettings$: vi.fn() };
  const tagRepositoryMock = { getCommunityTagCatalog$: vi.fn() };
  const notificationsMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
  };
  const globalErrorMock = { handleError: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.updateSettings$.mockReturnValue(of({
      communityId: 'community-1',
      updated: true,
      changedFields: ['joinPolicy', 'membersCanInvite'],
      generatedAt: 100,
    }));
    tagRepositoryMock.getCommunityTagCatalog$.mockReturnValue(of({
      items: [
        { id: 'intent:friendship', label: 'Amizade', category: 'intent' },
        { id: 'practice:bdsm', label: 'BDSM', category: 'practice' },
      ],
      generatedAt: 100,
    }));

    TestBed.configureTestingModule({
      imports: [CommunitySettingsComponent],
      providers: [
        provideRouter([]),
        { provide: CommunitySettingsRepository, useValue: repositoryMock },
        { provide: CommunityTagRepository, useValue: tagRepositoryMock },
        { provide: ErrorNotificationService, useValue: notificationsMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  function createFixture(
    role: 'owner' | 'admin' = 'owner',
    capacity: CommunityCapacityPreview = CAPACITY
  ) {
    const fixture = TestBed.createComponent(CommunitySettingsComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('settings', SETTINGS);
    fixture.componentRef.setInput('capacity', capacity);
    fixture.componentRef.setInput('viewerRole', role);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  it('preenche o formulário e permite capacidade somente ao owner', () => {
    const owner = createFixture('owner');
    const admin = createFixture('admin');

    expect(owner.componentInstance.form.getRawValue()).toEqual({
      name: SETTINGS.name,
      description: SETTINGS.description,
      rules: SETTINGS.rules,
      joinPolicy: SETTINGS.joinPolicy,
      membersCanInvite: SETTINGS.membersCanInvite,
      memberLimit: SETTINGS.memberLimit,
      tagIds: SETTINGS.tagIds,
    });
    expect(owner.componentInstance.form.controls.memberLimit.enabled).toBe(true);
    expect(admin.componentInstance.form.controls.memberLimit.disabled).toBe(true);
    expect(admin.nativeElement.textContent).toContain(
      'Somente o proprietário pode alterar a capacidade.'
    );
  });

  it('mostra regularização apenas ao proprietário quando o backend restringe capacidade', () => {
    const restrictedCapacity: CommunityCapacityPreview = {
      ...CAPACITY,
      configuredLimit: 250,
      effectiveLimit: 100,
      memberCount: 80,
      restrictedByOwnerPlan: true,
      memberLimitOptions: CAPACITY_OPTIONS.map((option) => ({
        ...option,
        allowed: option.memberLimit <= 100,
      })),
    };
    const owner = createFixture('owner', restrictedCapacity);
    const admin = createFixture('admin', restrictedCapacity);

    expect(owner.nativeElement.textContent).toContain('Regularização necessária');
    expect(owner.nativeElement.textContent).toContain(
      'Nenhum membro existente será removido automaticamente.'
    );
    expect(
      owner.nativeElement.querySelector(
        '.community-settings__regularization a'
      )?.getAttribute('href')
    ).toBe('/subscription-plan');
    expect(admin.nativeElement.textContent).not.toContain('Regularização necessária');
  });

  it('permite aumentar capacidade com opção liberada pelo backend', () => {
    const fixture = createFixture('owner');
    const option = CAPACITY_OPTIONS.find((item) => item.memberLimit === 100)!;

    fixture.componentInstance.selectMemberLimit(option);

    expect(fixture.componentInstance.form.controls.memberLimit.value).toBe(100);
    expect(notificationsMock.showWarning).not.toHaveBeenCalled();
  });

  it('não infere acesso a capacidade bloqueada no Angular', () => {
    const fixture = createFixture('owner');
    const option = CAPACITY_OPTIONS.find((item) => item.memberLimit === 250)!;

    fixture.componentInstance.selectMemberLimit(option);

    expect(fixture.componentInstance.form.controls.memberLimit.value).toBe(25);
    expect(notificationsMock.showWarning).toHaveBeenCalledWith(
      'Premium é necessário para escolher essa capacidade.'
    );
  });

  it('salva políticas e tags pela callable e emite atualização', () => {
    const fixture = createFixture();
    const changed = vi.fn();
    fixture.componentInstance.settingsChanged.subscribe(changed);
    fixture.componentInstance.form.controls.joinPolicy.setValue('invite_only');
    fixture.componentInstance.form.controls.membersCanInvite.setValue(true);
    fixture.componentInstance.toggleTag('practice:bdsm');

    fixture.nativeElement.querySelector('form').dispatchEvent(
      new Event('submit')
    );
    fixture.detectChanges();

    expect(repositoryMock.updateSettings$).toHaveBeenCalledWith(
      expect.objectContaining({
        communityId: 'community-1',
        joinPolicy: 'invite_only',
        membersCanInvite: true,
        tagIds: ['intent:friendship', 'practice:bdsm'],
        requestId: expect.stringMatching(/^[A-Za-z0-9_-]{16,64}$/),
      })
    );
    expect(notificationsMock.showSuccess).toHaveBeenCalledWith(
      'Configurações da Comunidade atualizadas.'
    );
    expect(changed).toHaveBeenCalledOnce();
  });

  it('explica autenticação recente sem contornar o tratamento central', () => {
    repositoryMock.updateSettings$.mockReturnValue(throwError(() => ({
      details: { reason: 'recent-authentication-required' },
    })));
    const fixture = createFixture();
    fixture.componentInstance.form.controls.memberLimit.setValue(50);
    fixture.componentInstance.form.controls.memberLimit.markAsDirty();
    fixture.componentInstance.save();
    fixture.detectChanges();

    expect(notificationsMock.showError).toHaveBeenCalledWith(
      'Por segurança, saia e entre novamente antes de alterar a capacidade.'
    );
    expect(globalErrorMock.handleError).toHaveBeenCalledOnce();
  });
});
