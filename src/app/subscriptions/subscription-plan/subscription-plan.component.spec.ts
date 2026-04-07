// src/app/subscriptions/subscription-plan/subscription-plan.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
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
import { Router } from '@angular/router';

import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { IncompleteProfileSubscriptionNoticeService } from '../application/incomplete-profile-subscription-notice.service';

describe('SubscriptionPlanComponent', () => {
  let component: SubscriptionPlanComponent;
  let fixture: ComponentFixture<SubscriptionPlanComponent>;

  let routerMock: {
    navigate: Mock;
  };

  let currentUserSubject: BehaviorSubject<any>;
  let warningSubject: BehaviorSubject<boolean>;

  let currentUserStoreMock: {
    user$: any;
  };

  let noticeServiceMock: {
    shouldShow$: Mock;
    hydrate: Mock;
  };

  beforeEach(async () => {
    currentUserSubject = new BehaviorSubject<any>({
      uid: 'user-1',
      emailVerified: true,
      profileCompleted: false,
    });

    warningSubject = new BehaviorSubject<boolean>(true);

    routerMock = {
      navigate: vi.fn().mockResolvedValue(true),
    };

    currentUserStoreMock = {
      user$: currentUserSubject.asObservable(),
    };

    noticeServiceMock = {
      shouldShow$: vi.fn().mockReturnValue(warningSubject.asObservable()),
      hydrate: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [SubscriptionPlanComponent],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: CurrentUserStoreService, useValue: currentUserStoreMock },
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
    component.subscribe('premium');

    expect(routerMock.navigate).toHaveBeenCalledWith(['/checkout'], {
      queryParams: { plan: 'premium' },
    });
  });

  it('deve exibir o aviso de perfil incompleto quando shouldShowSubscriptionWarning$ for true', () => {
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Você pode assinar mesmo com o perfil incompleto');
    expect(text).toContain(
      'Sua assinatura será ativada normalmente, mas algumas funções sociais e de descoberta podem continuar limitadas até a conclusão do perfil.'
    );
  });

  it('deve ocultar o aviso quando shouldShowSubscriptionWarning$ for false', () => {
    warningSubject.next(false);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;

    expect(text).not.toContain('Você pode assinar mesmo com o perfil incompleto');
  });

  it('deve continuar renderizando os cards dos planos mesmo com o aviso oculto', () => {
    warningSubject.next(false);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Plano Básico');
    expect(text).toContain('Plano Premium');
    expect(text).toContain('Plano VIP');
  });
});