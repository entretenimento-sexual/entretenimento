// src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.spec.ts
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { By } from '@angular/platform-browser';

import { Observable, of, throwError } from 'rxjs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { FinalizarCadastroComponent } from './finalizar-cadastro.component';

import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { PhotoEditorLauncherService } from '../../core/services/image-handling/photo-editor-launcher.service';
import { FormValidationFocusDirective } from '../../shared/form-validation-focus/form-validation-focus.directive';

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
  let photoEditorMock: { editFile$: MockFn };
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
    localStorage.clear();

    registerFlowFacadeMock = {
      vm$: of(vm),
    };

    profileCompletionFacadeMock = {
      getEstados$: vi.fn(() => of([
        {
          id: 33,
          sigla: 'RJ',
          nome: 'Rio de Janeiro',
        },
      ])),
      getMunicipios$: vi.fn(() => of([
        {
          id: 3304557,
          nome: 'Rio de Janeiro',
        },
      ])),
      loadUserForFormByUid$: vi.fn(() => of({
        email: 'teste@email.com',
        nickname: 'tester',
        gender: 'homem',
        orientation: 'homossexual',
        estado: 'RJ',
        municipio: 'Rio de Janeiro',
      })),
      saveProfileCompletion$: vi.fn(() => of(void 0)),
      uploadProfileAvatarAfterSave$: vi.fn(() => of({
        status: 'skipped',
      })),
    };

    currentUserStoreMock = {
      patch: vi.fn(),
    };

    photoEditorMock = {
      editFile$: vi.fn(() => of(null)),
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
        FormValidationFocusDirective,
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
          provide: PhotoEditorLauncherService,
          useValue: photoEditorMock,
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

  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
  });

  it('should create and load initial profile completion data', () => {
    expect(component).toBeTruthy();
    expect(profileCompletionFacadeMock.getEstados$).toHaveBeenCalled();
    expect(
      profileCompletionFacadeMock.loadUserForFormByUid$
    ).toHaveBeenCalledWith('u1', vm);
    expect(component.email).toBe('teste@email.com');
    expect(component.nickname).toBe('tester');
    expect(component.needsNickname).toBe(false);
    expect(component.gender).toBe('homem');
    expect(component.orientation).toBe('homossexual');
    expect(component.selectedEstado).toBe('RJ');
    expect(component.selectedMunicipio).toBe('Rio de Janeiro');
  });

  it('should save profile completion and redirect to adult consent when submitted', () => {
    component.onSubmit();

    expect(
      profileCompletionFacadeMock.saveProfileCompletion$
    ).toHaveBeenCalledWith({
      uid: 'u1',
      vm,
      nickname: 'tester',
      gender: 'homem',
      orientation: 'homossexual',
      estado: 'RJ',
      municipio: 'Rio de Janeiro',
    });

    expect(currentUserStoreMock.patch).toHaveBeenCalledWith({
      nickname: 'tester',
      profileCompleted: true,
      gender: 'homem',
      orientation: 'homossexual',
      estado: 'RJ',
      municipio: 'Rio de Janeiro',
    });

    expect(errorNotificationMock.showSuccess).toHaveBeenCalledWith(
      'Perfil finalizado com sucesso!'
    );
    expect(router.navigateByUrl).toHaveBeenCalledWith(
      '/adulto/confirmar',
      { replaceUrl: true }
    );
    expect(component.hasUnsavedChanges()).toBe(false);
  });

  it('abre o editor canônico com preset quadrado antes de guardar o avatar', () => {
    const source = new File(['source'], 'avatar.jpeg', { type: 'image/jpeg' });
    const edited = new File(['edited'], 'avatar-editada.jpg', {
      type: 'image/jpeg',
    });
    photoEditorMock.editFile$.mockReturnValueOnce(of({
      kind: 'image',
      file: edited,
      imageStateStr: '{"version":2}',
      width: 1024,
      height: 1024,
      context: 'profile-avatar',
      preset: 'avatar-square',
      metadataStripped: true,
    }));

    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [source],
    });

    component.uploadFile({ target: input } as unknown as Event);

    expect(photoEditorMock.editFile$).toHaveBeenCalledWith(source, {
      source: 'profile-avatar',
      context: 'profile-avatar',
      preset: 'avatar-square',
    });
    expect(component.avatarFile).toBe(edited);
    expect(component.avatarMaxMegabytes).toBe(8);
    expect(component.isEditingAvatar).toBe(false);
  });

  it('preserva o avatar anterior se o usuário cancelar a nova edição', () => {
    const current = new File(['current'], 'avatar-atual.jpg', {
      type: 'image/jpeg',
    });
    component.avatarFile = current;
    photoEditorMock.editFile$.mockReturnValueOnce(of(null));

    const next = new File(['next'], 'avatar-novo.jpg', { type: 'image/jpeg' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [next],
    });

    component.uploadFile({ target: input } as unknown as Event);

    expect(component.avatarFile).toBe(current);
  });

  it('mantém erro técnico no handler global e um único feedback contextual na página', () => {
    profileCompletionFacadeMock.saveProfileCompletion$.mockReturnValueOnce(
      throwError(() => new Error('write-failed'))
    );

    component.onSubmit();

    expect(globalErrorHandlerMock.handleError).toHaveBeenCalledTimes(1);
    const [reportedError] = globalErrorHandlerMock.handleError.mock.calls[0];
    expect(reportedError).toBeInstanceOf(Error);
    expect(reportedError.skipUserNotification).toBe(true);
    expect(component.messageKind).toBe('error');
    expect(component.message).toContain(
      'Ocorreu um erro ao finalizar o cadastro'
    );
    expect(errorNotificationMock.showError).not.toHaveBeenCalled();
  });

  it('identifica e descarta alterações do onboarding', () => {
    component.gender = 'mulher';
    component.onDraftChange();

    expect(component.hasUnsavedChanges()).toBe(true);

    component.discardUnsavedChanges();
    expect(component.hasUnsavedChanges()).toBe(false);
  });

  it('renderiza erros obrigatórios como alertas inline acessíveis', () => {
    component.gender = '';
    component.selectedEstado = '';
    component.selectedMunicipio = '';

    component.onSubmit();
    fixture.detectChanges();

    const errors = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.form-field .tooltip-error'
      ) as NodeListOf<HTMLElement>
    );

    expect(errors).toHaveLength(3);
    for (const error of errors) {
      expect(error.getAttribute('role')).toBe('alert');
      expect(error.getAttribute('aria-live')).toBe('polite');
      expect(error.getAttribute('aria-atomic')).toBe('true');
    }
  });

  it('conecta o ngForm ao contrato compartilhado de foco de validação', () => {
    const formDebug = fixture.debugElement.query(
      By.directive(FormValidationFocusDirective)
    );

    expect(formDebug).toBeTruthy();
    expect(
      formDebug.injector.get(FormValidationFocusDirective)
    ).toBeInstanceOf(FormValidationFocusDirective);
  });

  it('move o foco para o primeiro campo inválido ao submeter o perfil incompleto', async () => {
    component.needsNickname = true;
    component.nickname = '';
    component.gender = '';
    component.selectedEstado = '';
    component.selectedMunicipio = '';
    fixture.detectChanges();

    await fixture.whenStable();
    fixture.detectChanges();

    const nickname = fixture.nativeElement.querySelector(
      '#nickname'
    ) as HTMLInputElement;
    const focusSpy = vi.spyOn(nickname, 'focus');
    const scrollSpy = vi.fn();
    Object.defineProperty(nickname, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    });

    const formDebug = fixture.debugElement.query(By.css('form'));
    formDebug.triggerEventHandler('submit', new Event('submit'));
    fixture.detectChanges();

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(component.formErrors['nickname']).toBeTruthy();
  });

  it('expõe estado ocupado do formulário durante salvamento, upload ou edição de avatar', () => {
    component.isEditingAvatar = true;
    fixture.detectChanges();

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    expect(form.getAttribute('aria-busy')).toBe('true');
  });
});
