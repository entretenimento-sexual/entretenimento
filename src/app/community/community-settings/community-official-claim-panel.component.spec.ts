import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import type { CommunityOfficialClaimCapabilityResponse } from '../data-access/community-official-claim-capability.model';
import { CommunityOfficialClaimRepository } from '../data-access/community-official-claim.repository';
import { CommunityOfficialClaimPanelComponent } from './community-official-claim-panel.component';

describe('CommunityOfficialClaimPanelComponent', () => {
  const repositoryMock = {
    getCommunityOfficialClaimCapability$: vi.fn(),
    getMyCommunityOfficialClaim$: vi.fn(),
    submitCommunityOfficialClaim$: vi.fn(),
  };
  const notificationsMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
  };
  const applicationErrorMock = { report: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.getMyCommunityOfficialClaim$.mockReturnValue(of({
      claim: null,
      generatedAt: 100,
    }));
    repositoryMock.submitCommunityOfficialClaim$.mockReturnValue(of({
      associationKey: 'venue:venue-1',
      status: 'verified',
      submitted: true,
    }));

    TestBed.configureTestingModule({
      imports: [CommunityOfficialClaimPanelComponent],
      providers: [
        {
          provide: CommunityOfficialClaimRepository,
          useValue: repositoryMock,
        },
        { provide: ErrorNotificationService, useValue: notificationsMock },
        { provide: ApplicationErrorService, useValue: applicationErrorMock },
      ],
    });
  });

  function createFixture(capability: CommunityOfficialClaimCapabilityResponse) {
    repositoryMock.getCommunityOfficialClaimCapability$.mockReturnValue(of(capability));
    const fixture = TestBed.createComponent(CommunityOfficialClaimPanelComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  it('seleciona automaticamente somente o único vínculo e exige declaração', () => {
    const fixture = createFixture({
      canSubmit: true,
      reason: 'eligible',
      candidates: [{
        target: { type: 'venue', id: 'venue-1' },
        label: 'Casa Aurora',
      }],
      generatedAt: 100,
    });

    const text = fixture.nativeElement.textContent as string;
    const checkbox = fixture.nativeElement.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement;

    expect(fixture.nativeElement.querySelector('select')).toBeNull();
    expect(fixture.componentInstance.targetKey.value).toBe('venue:venue-1');
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
    expect(text).toContain('Casa Aurora');
    expect(text).toContain('Local');
    expect(text).toContain('Declaro que tenho autorização');
    expect(text).toContain('Solicitar selo oficial');
    expect(text).not.toContain('Proprietário');
    expect(text).not.toContain('Gestor autorizado');
    expect(text).not.toContain('Representante autorizado');
    expect(text).not.toContain('KYB');
  });

  it('não pré-seleciona quando existem várias entidades elegíveis', () => {
    const fixture = createFixture({
      canSubmit: true,
      reason: 'eligible',
      candidates: [
        {
          target: { type: 'venue', id: 'venue-1' },
          label: 'Casa Aurora',
        },
        {
          target: { type: 'organization', id: 'organization-1' },
          label: 'Aurora Produções',
        },
      ],
      generatedAt: 100,
    });

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    const text = fixture.nativeElement.textContent as string;
    expect(select).not.toBeNull();
    expect(select.options).toHaveLength(3);
    expect(select.options[0]?.textContent).toContain('Selecione uma entidade');
    expect(fixture.componentInstance.targetKey.value).toBe('');
    expect(text).toContain('O que esta comunidade representa?');
    expect(text).toContain('Casa Aurora — Local');
    expect(text).toContain('Aurora Produções — Organização');
    expect(text).not.toContain('Gestor autorizado');
    expect(text).not.toContain('Representante autorizado');
  });

  it('mantém a solicitação bloqueada enquanto a declaração não for aceita', () => {
    const fixture = createFixture({
      canSubmit: true,
      reason: 'eligible',
      candidates: [{
        target: { type: 'venue', id: 'venue-1' },
        label: 'Casa Aurora',
      }],
      generatedAt: 100,
    });

    const button = fixture.nativeElement.querySelector(
      '.official-claim__submit'
    ) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    fixture.componentInstance.submit();

    expect(repositoryMock.submitCommunityOfficialClaim$).not.toHaveBeenCalled();
    expect(notificationsMock.showWarning).toHaveBeenCalledWith(
      'Confirme que você tem autorização para representar esta entidade.'
    );
  });

  it('envia somente entidade e declaração, sem detalhes técnicos de autoridade', () => {
    const fixture = createFixture({
      canSubmit: true,
      reason: 'eligible',
      candidates: [{
        target: { type: 'venue', id: 'venue-1' },
        label: 'Casa Aurora',
      }],
      generatedAt: 100,
    });

    fixture.componentInstance.authorizationAccepted.setValue(true);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '.official-claim__submit'
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();
    fixture.detectChanges();

    expect(repositoryMock.submitCommunityOfficialClaim$).toHaveBeenCalledTimes(1);
    const submittedInput =
      repositoryMock.submitCommunityOfficialClaim$.mock.calls[0]?.[0];
    expect(submittedInput).toMatchObject({
      communityId: 'community-1',
      target: { type: 'venue', id: 'venue-1' },
      declarationAccepted: true,
    });
    expect(submittedInput).not.toHaveProperty('authorityRole');
    expect(submittedInput).not.toHaveProperty('sponsorOrganizationId');
    expect(submittedInput).not.toHaveProperty('evidenceReferences');
    expect(notificationsMock.showSuccess).toHaveBeenCalledWith(
      'Selo oficial confirmado.'
    );
  });

  it('traduz verificação obrigatória para linguagem de produto', () => {
    const fixture = createFixture({
      canSubmit: false,
      reason: 'verification_required',
      candidates: [],
      generatedAt: 100,
    });

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('conclua primeiro a verificação necessária');
    expect(text).not.toContain('KYB');
    expect(text).not.toContain('grant');
    expect(text).not.toContain('autoridade canônica');
  });
});
