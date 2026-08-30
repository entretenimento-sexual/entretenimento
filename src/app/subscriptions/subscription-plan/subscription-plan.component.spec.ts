// src/app/subscriptions/subscription-plan/subscription-plan.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, of, take } from 'rxjs';
import {
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
  vi,
  type Mock,
} from 'vitest';

import { SubscriptionPlanComponent } from './subscription-plan.component';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';

import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { PlatformSubscriptionAccessService } from '../../core/services/subscriptions/platform-subscription-access.service';
import { IncompleteProfileSubscriptionNoticeService } from '../application/incomplete-profile-subscription-notice.service';
import { COMMUNITY_CREATE_RETURN_URL } from '../domain/subscription-flow-context.model';

describe('SubscriptionPlanComponent', () => {
  let component: SubscriptionPlanComponent;
  let fixture: ComponentFixture<SubscriptionPlanComponent>;

  let routerMock: { navigate: Mock };
  let currentUserSubject: BehaviorSubject<any>;
  let warningSubject: BehaviorSubject<boolean>;
  let queryParamMapSubject: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let currentUserStoreMock: { user$: any };
  let noticeServiceMock: { shouldShow$: Mock; hydrate: Mock };

  beforeEach(async () => {
    currentUserSubject = new BehaviorSubject<any>({
      uid: 'user-1',
      emailVerified: true,
      profileCompleted: false,
    });
    warningSubject = new BehaviorSubject<boolean>(true);
    queryParamMapSubject = new BehaviorSubject(convertToParamMap({}));
    routerMock = { navigate: vi.fn().mockResolvedValue(true) };
    currentUserStoreMock = { user$: currentUserSubject.asObservable() };
    noticeServiceMock = {
      shouldShow$: vi.fn().mockReturnValue(warningSubject.asObservable()),
      hydrate: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [SubscriptionPlanComponent],
      providers: [
        { provide: Router, useValue: routerMock },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: queryParamMapSubject.asObservable() },
        },
        { provide: CurrentUserStoreService, useValue: currentUserStoreMock },
        {
          provide: PlatformSubscriptionAccessService,
          useValue: {
            state$: of({
              active: false,
              role: null,
              startsAt: null,
              endsAt: null,
              projectionVersion: null,
              reason: 'missing-user',
            }),
          },
        },
        {
          provide: IncompleteProfileSubscriptionNoticeService,
          useValue: noticeServiceMock,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SubscriptionPlanComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('deve criar o componente', () => {
    expect(component).toBeTruthy();
  });

  it('deve hidratar o estado do aviso com o uid do usuário no init', () => {
    expect(noticeServiceMock.hydrate).toHaveBeenCalledWith('user-1');
  });

  it('deve navegar para o checkout com o plano selecionado', () => {
    component.subscribe('premium', {
      uid: 'user-1',
      subscriptionActive: false,
      currentPlanKey: null,
      currentPlanLabel: null,
      statusTitle: 'Sem assinatura ativa',
      statusDescription:
        'Você ainda não possui um plano ativo reconhecido na plataforma.',
      canGoToAccount: true,
      canGoToProfile: true,
      flowContext: { minimumRole: null, returnUrl: null },
      communityCreationFlow: false,
    });

    expect(routerMock.navigate).toHaveBeenCalledWith(['/checkout'], {
      queryParams: { plan: 'premium' },
    });
  });

  it('contextualiza a criação e preserva o retorno ao checkout', async () => {
    queryParamMapSubject.next(convertToParamMap({
      minimumRole: 'basic',
      returnUrl: COMMUNITY_CREATE_RETURN_URL,
    }));
    fixture.detectChanges();

    const vm = await firstValueFrom(component.vm$.pipe(take(1)));
    const text = fixture.nativeElement.textContent;
    const recommendedPlan = fixture.nativeElement.querySelector(
      '.plan[data-recommended="true"]'
    ) as HTMLElement | null;

    expect(text).toContain('Escolha o plano para continuar a criação');
    expect(text).toContain('Plano Básico é o nível mínimo indicado');
    expect(recommendedPlan?.textContent).toContain('Plano Básico');
    expect(recommendedPlan?.textContent).toContain(
      'Recomendado para continuar'
    );

    component.subscribe('basic', vm);

    expect(routerMock.navigate).toHaveBeenCalledWith(['/checkout'], {
      queryParams: {
        plan: 'basic',
        minimumRole: 'basic',
        returnUrl: COMMUNITY_CREATE_RETURN_URL,
      },
    });
  });

  it('descarta contexto de retorno externo', async () => {
    queryParamMapSubject.next(convertToParamMap({
      minimumRole: 'basic',
      returnUrl: 'https://example.com/capture',
    }));
    fixture.detectChanges();

    const vm = await firstValueFrom(component.vm$.pipe(take(1)));

    expect(vm.flowContext).toEqual({
      minimumRole: 'basic',
      returnUrl: null,
    });
    expect(vm.communityCreationFlow).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain(
      'Escolha o plano para continuar a criação'
    );
  });

  it('impede escolher um plano abaixo do mínimo solicitado', () => {
    queryParamMapSubject.next(convertToParamMap({
      minimumRole: 'premium',
      returnUrl: COMMUNITY_CREATE_RETURN_URL,
    }));
    fixture.detectChanges();

    const cards = Array.from(
      fixture.nativeElement.querySelectorAll('.plan') as NodeListOf<HTMLElement>
    );
    const basicCard = cards.find((card) =>
      card.textContent?.includes('Plano Básico')
    );
    const basicButton = basicCard?.querySelector('button');

    expect(basicCard?.textContent).toContain(
      'Este plano não atende ao passo atual'
    );
    expect(basicButton?.disabled).toBe(true);
    expect(basicButton?.textContent).toContain(
      'Não atende a esta criação'
    );
  });

  it('não navega para downgrade imediato e explica próximo ciclo', () => {
    const vm = {
      uid: 'user-1',
      subscriptionActive: true,
      currentPlanKey: 'vip' as const,
      currentPlanLabel: 'Plano VIP',
      statusTitle: 'Plano VIP ativo',
      statusDescription: 'Seu plano atual reconhecido na plataforma é Plano VIP.',
      canGoToAccount: true,
      canGoToProfile: true,
      flowContext: { minimumRole: null, returnUrl: null },
      communityCreationFlow: false,
    };

    expect(component.isDowngrade('basic', vm)).toBe(true);
    expect(component.canSelectPlan('basic', vm)).toBe(false);
    expect(component.getPlanActionLabel('basic', vm)).toBe(
      'Redução no próximo ciclo'
    );

    component.subscribe('basic', vm);

    expect(routerMock.navigate).not.toHaveBeenCalledWith(
      ['/checkout'],
      expect.anything()
    );
  });

  it('deve exibir o aviso de perfil incompleto', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Assinatura com perfil em conclusão');
    expect(text).toContain(
      'Seu plano será ativado normalmente. Algumas funções sociais e de descoberta podem continuar limitadas até a conclusão do perfil.'
    );
  });

  it('deve ocultar o aviso quando configurado', () => {
    warningSubject.next(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain(
      'Assinatura com perfil em conclusão'
    );
  });

  it('deve continuar renderizando os cards dos planos sem duplicar quotas autoritativas no frontend', () => {
    warningSubject.next(false);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Plano Básico');
    expect(text).toContain('Plano Premium');
    expect(text).toContain('Plano VIP');
    expect(text).toContain('Criação e administração de Comunidade pessoal');
    expect(text).toContain('Mais espaço para criar e administrar Comunidades pessoais');
    expect(text).toContain('Maior liberdade para administrar Comunidades pessoais');
    expect(text).not.toContain('Crie 1 Comunidade pessoal');
    expect(text).not.toContain('Crie até 3 Comunidades pessoais');
    expect(text).not.toContain('Crie até 5 Comunidades pessoais');
  });
});