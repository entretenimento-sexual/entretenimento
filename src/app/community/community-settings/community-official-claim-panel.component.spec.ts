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
      submitted: true,
      generatedAt: 100,
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

  it('elimina o seletor quando existe apenas um vínculo elegível', () => {
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
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
    expect(text).toContain('Casa Aurora');
    expect(text).toContain('Local');
    expect(text).toContain('Solicitar selo oficial');
    expect(text).not.toContain('Proprietário');
    expect(text).not.toContain('KYB');
  });

  it('mostra apenas uma escolha simples quando existem vários vínculos', () => {
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
    expect(select.options).toHaveLength(2);
    expect(text).toContain('O que esta comunidade representa?');
    expect(text).toContain('Casa Aurora — Local');
    expect(text).toContain('Aurora Produções — Organização');
    expect(text).not.toContain('Gestor autorizado');
    expect(text).not.toContain('Representante autorizado');
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
    expect(text).not.toContain('autoridade');
  });
});
