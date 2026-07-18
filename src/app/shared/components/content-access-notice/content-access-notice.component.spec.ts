import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { ContentAccessDecision } from 'src/app/core/access/content-access-policy.model';
import {
  buildContentAccessNoticeViewModel,
  ContentAccessNoticeComponent,
} from './content-access-notice.component';

function createDecision(
  overrides: Partial<ContentAccessDecision> = {}
): ContentAccessDecision {
  return {
    allowed: false,
    reason: 'subscription_inactive',
    recommendedAction: 'upgrade_subscription',
    minimumRole: 'premium',
    missingProfileFields: [],
    ...overrides,
  };
}

describe('buildContentAccessNoticeViewModel', () => {
  it('gera mensagem curta para assinatura inativa', () => {
    expect(
      buildContentAccessNoticeViewModel(createDecision()).message
    ).toBe('Ative sua assinatura para continuar.');
  });

  it('expõe o nível mínimo sem repetir títulos', () => {
    expect(
      buildContentAccessNoticeViewModel(
        createDecision({ reason: 'role_insufficient', minimumRole: 'vip' })
      ).message
    ).toBe('Disponível a partir do plano VIP.');
  });

  it('orienta conclusão de perfil para campos ausentes', () => {
    expect(
      buildContentAccessNoticeViewModel(
        createDecision({
          reason: 'profile_field_missing',
          recommendedAction: 'complete_profile',
          minimumRole: null,
          missingProfileFields: ['nickname'],
        })
      ).actionLabel
    ).toBe('Completar');
  });

  it('oferece nova verificação sem encaminhar para compra', () => {
    expect(
      buildContentAccessNoticeViewModel(
        createDecision({
          reason: 'access_check_unavailable',
          recommendedAction: null,
        })
      )
    ).toEqual(
      expect.objectContaining({
        message: 'Não foi possível verificar o acesso agora.',
        actionLabel: 'Tentar novamente',
      })
    );
  });
});

describe('ContentAccessNoticeComponent', () => {
  const navigationMock = {
    navigateForDecision: vi.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [ContentAccessNoticeComponent],
      providers: [
        {
          provide: ContentAccessNavigationService,
          useValue: navigationMock,
        },
      ],
    }).compileComponents();
  });

  it('não renderiza aviso para decisão permitida', () => {
    const fixture = TestBed.createComponent(ContentAccessNoticeComponent);

    fixture.componentRef.setInput(
      'decision',
      createDecision({
        allowed: true,
        reason: null,
        recommendedAction: null,
      })
    );
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.content-access-notice')
    ).toBeNull();
  });

  it('renderiza uma única mensagem e nenhuma hierarquia visual de títulos', () => {
    const fixture = TestBed.createComponent(ContentAccessNoticeComponent);
    fixture.componentRef.setInput('decision', createDecision());
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('p')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('h1, h2, h3')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'Ative sua assinatura para continuar.'
    );
  });

  it('encaminha a decisão ao serviço ao acionar o botão', async () => {
    const fixture = TestBed.createComponent(ContentAccessNoticeComponent);
    const decision = createDecision();
    fixture.componentRef.setInput('decision', decision);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click();
    await fixture.whenStable();

    expect(navigationMock.navigateForDecision).toHaveBeenCalledWith(decision);
  });

  it('emite nova tentativa sem navegar para planos', async () => {
    const fixture = TestBed.createComponent(ContentAccessNoticeComponent);
    const retrySpy = vi.fn();
    fixture.componentRef.setInput(
      'decision',
      createDecision({
        reason: 'access_check_unavailable',
        recommendedAction: null,
      })
    );
    fixture.componentInstance.retryRequested.subscribe(retrySpy);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click();
    await fixture.whenStable();

    expect(retrySpy).toHaveBeenCalledTimes(1);
    expect(navigationMock.navigateForDecision).not.toHaveBeenCalled();
  });
});
