// src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.spec.ts
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FinalizarCadastroComponent } from './finalizar-cadastro.component';

import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';

import { ProfileCompletionFacade } from '../data-access/profile-completion.facade';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import { RegisterFlowVm } from '../data-access/register-flow.model';

type MockFn = ReturnType<typeof vi.fn>;

interface ProfileCompletionFacadeMock {
  loadUserForFormByUid$: MockFn;
  getEstados$: MockFn;
  getMunicipios$: MockFn;
  saveProfileCompletion$: MockFn;
  uploadProfileAvatarAfterSave$: MockFn;
}

interface CurrentUserStoreMock {
  patch: MockFn;
}

describe('FinalizarCadastroComponent', () => {
  let fixture: ComponentFixture<FinalizarCadastroComponent>;
  let component: FinalizarCadastroComponent;

  let router: Router;
  let registerFlowFacadeMock: { vm$: Observable<RegisterFlowVm> };
  let profileCompletionFacadeMock: ProfileCompletionFacadeMock;
  let currentUserStoreMock: CurrentUserStoreMock;
  let globalErrorHandlerMock: { handleError: MockFn };
  let errorNotificationMock: {
    showError: MockFn;
    showSuccess: MockFn;
    showWarning: MockFn;
    showInfo: MockFn;
  };

  const vm: RegisterFlowVm = {
    authReady: true,
    uid: 'u1',
    email: 'teste@email.com',
    emailVerified: true,
    userResolved: true,
    userExists: true,
    termsAccepted: true,
    profileCompleted: false,
    adultConsentAccepted: false,
    currentStep: 'profileCompletion',
    nextRoute: '/adulto/confirmar',
    progress: 50,
    canContinue: true,
    primaryActionLabel: 'Concluir cadastro',
  };

  beforeEach(async () => {
    registerFlowFacadeMock = {
      vm$: of(vm),
    };

    profileCompletionFacadeMock = {
      getEstados$: vi.fn(() =>
        of([
          {
            id: 33,
            sigla: 'RJ',
            nome: 'Rio de Janeiro',
          },
        ])
      ),
      getMunicipios$: vi.fn(() =>
        of([
          {
            id: 3304557,
            nome: 'Rio de Janeiro',
          },
        ])
      ),
      loadUserForFormByUid$: vi.fn(() =>
        of({
          email: 'teste@email.com',
          nickname: 'tester',
          gender: 'homem',
          orientation: 'homossexual',
          estado: 'RJ',
          municipio: 'Rio de Janeiro',
        })
      ),
      saveProfileCompletion$: vi.fn(() => of(void 0)),
      uploadProfileAvatarAfterSave$: vi.fn(() =>
        of({
          status: 'skipped',
        })
      ),
    };

    currentUserStoreMock = {
      patch: vi.fn(),
    };

    globalErrorHandlerMock = {
      handleError: vi.fn(),
    };

    errorNotificationMock = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
      showWarning: vi.fn(),
      showInfo: vi.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [FinalizarCadastroComponent],
      imports: [
        RouterTestingModule,
        FormsModule,
        CommonModule,
      ],
      providers: [
        {
          provide: RegisterFlowFacade,
          useValue: registerFlowFacadeMock,
        },
        {
          provide: ProfileCompletionFacade,
          useValue: profileCompletionFacadeMock,
        },
        {
          provide: CurrentUserStoreService,
          useValue: currentUserStoreMock,
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: globalErrorHandlerMock,
        },
        {
          provide: ErrorNotificationService,
          useValue: errorNotificationMock,
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    fixture = TestBed.createComponent(FinalizarCadastroComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create and load initial profile completion data', () => {
    expect(component).toBeTruthy();

    expect(profileCompletionFacadeMock.getEstados$).toHaveBeenCalled();
    expect(profileCompletionFacadeMock.loadUserForFormByUid$).toHaveBeenCalledWith('u1', vm);

    expect(component.email).toBe('teste@email.com');
    expect(component.nickname).toBe('tester');
    expect(component.gender).toBe('homem');
    expect(component.orientation).toBe('homossexual');
    expect(component.selectedEstado).toBe('RJ');
    expect(component.selectedMunicipio).toBe('Rio de Janeiro');
  });

  it('should save profile completion and redirect to adult consent when submitted', () => {
    component.onSubmit();

    expect(profileCompletionFacadeMock.saveProfileCompletion$).toHaveBeenCalledWith({
      uid: 'u1',
      vm,
      gender: 'homem',
      orientation: 'homossexual',
      estado: 'RJ',
      municipio: 'Rio de Janeiro',
    });

    expect(currentUserStoreMock.patch).toHaveBeenCalledWith({
      profileCompleted: true,
      gender: 'homem',
      orientation: 'homossexual',
      estado: 'RJ',
      municipio: 'Rio de Janeiro',
    });

    expect(router.navigateByUrl).toHaveBeenCalledWith('/adulto/confirmar', {
      replaceUrl: true,
    });
  });
});