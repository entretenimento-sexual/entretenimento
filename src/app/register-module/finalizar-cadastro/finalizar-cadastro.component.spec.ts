// src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.spec.ts
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { By } from '@angular/platform-browser';

import { BehaviorSubject, NEVER, Observable, Subject, of, throwError } from 'rxjs';
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
import { LocalDraftService } from '../../core/services/drafts/local-draft.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { PhotoEditorLauncherService } from '../../core/services/image-handling/photo-editor-launcher.service';
import { NetworkStatusService } from '../../core/services/network/network-status.service';
import { FormValidationFocusDirective } from '../../shared/form-validation-focus/form-validation-focus.directive';

import { ProfileCompletionFacade } from '../data-access/profile-completion.facade';
import { RegisterFlowFacade } from '../data-access/register-flow.facade';
import { PROFILE_COMPLETED_NAVIGATION_INFO, type RegisterFlowVm } from '../data-access/register-flow.model';

type MockFn = ReturnType<typeof vi.fn>;

interface ProfileCompletionFacadeMock {
  loadUserForFormByUid$: MockFn;
  getEstados$: MockFn;
  getMunicipios$: MockFn;
  saveProfileCompletion$: MockFn;
  confirmProfileCompletion$: MockFn;
  uploadProfileAvatarAfterSave$: MockFn;
}

interface CurrentUserStoreMock {
  patch: MockFn;
  getLoggedUserUIDSnapshot: MockFn;
  getLoggedUserUID$: MockFn;
  getSnapshot: MockFn;
}

describe('FinalizarCadastroComponent', () => {
  let fixture: ComponentFixture<FinalizarCadastroComponent>;
  let component: FinalizarCadastroComponent;

  let router: Router;
  let registerFlowFacadeMock: { vm$: Observable<RegisterFlowVm> };
  let profileCompletionFacadeMock: ProfileCompletionFacadeMock;
  let currentUserStoreMock: CurrentUserStoreMock;
  let online$: BehaviorSubject<boolean>;
  let accountUid$: BehaviorSubject<string | null>;
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
    ageEligibilityAllowed: true,
    profileCompleted: false,
    currentStep: 'profileCompletion',
    nextRoute: '/register/finalizar-cadastro',
    progress: 50,
    canContinue: true,
    primaryActionLabel: 'Concluir cadastro',
  };

  beforeEach(async () => {
    localStorage.clear();
    online$ = new BehaviorSubject(true);
    accountUid$ = new BehaviorSubject<string | null>('u1');

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
      confirmProfileCompletion$: vi.fn(() => of(false)),
      uploadProfileAvatarAfterSave$: vi.fn(() => of({
        status: 'skipped',
      })),
    };

    currentUserStoreMock = {
      patch: vi.fn(),
      getLoggedUserUIDSnapshot: vi.fn(() => accountUid$.value),
      getLoggedUserUID$: vi.fn(() => accountUid$.asObservable()),
      getSnapshot: vi.fn(() => ({ uid: 'u1' })),
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
        { provide: NetworkStatusService, useValue: { isOnline$: online$ } },
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

  it('preenche o apelido recuperado com o campo editável quando a reserva ficou pendente', async () => {
    profileCompletionFacadeMock.loadUserForFormByUid$.mockReturnValueOnce(of({
      email: 'teste@email.com', nickname: '', savedNicknameSuggestion: 'apelidosalvo extra',
      gender: '', orientation: '', estado: '', municipio: '',
    }));
    const reopened = TestBed.createComponent(FinalizarCadastroComponent);
    try {
      reopened.detectChanges();
      await reopened.whenStable();
      const field: HTMLInputElement = reopened.nativeElement.querySelector('#nickname');
      expect(field.value).toBe('apelidosalvo');
      expect(field.disabled).toBe(false);
      expect(reopened.nativeElement.querySelector('#nickname-complement').value).toBe('extra');
      expect(reopened.nativeElement.querySelector('#gender')).not.toBeNull();
    } finally {
      reopened.destroy();
    }
  });

  it('atualiza o formulário e os municípios quando os dados chegam de forma assíncrona', async () => {
    const profile$ = new Subject<{
      email: string; nickname: string; gender: string; orientation: string; estado: string; municipio: string;
    }>();
    const municipios$ = new Subject<{ id: number; nome: string }[]>();
    profileCompletionFacadeMock.loadUserForFormByUid$.mockReturnValueOnce(profile$);
    profileCompletionFacadeMock.getMunicipios$.mockReturnValueOnce(municipios$);
    const delayed = TestBed.createComponent(FinalizarCadastroComponent);
    try {
      delayed.autoDetectChanges();
      const view = delayed.nativeElement as HTMLElement;
      expect(view.textContent).toContain('Carregando os dados do seu perfil');
      profile$.next({
        email: 'teste@email.com', nickname: 'tester', gender: 'homem', orientation: '', estado: '', municipio: '',
      });
      await delayed.whenStable();
      expect(view.querySelector('#gender')).not.toBeNull();
      delayed.componentInstance.advanceProfileStep();
      delayed.componentInstance.advanceProfileStep();
      delayed.detectChanges();
      await delayed.whenStable();

      const estado = view.querySelector<HTMLSelectElement>('#estado')!;
      estado.value = 'RJ';
      estado.dispatchEvent(new Event('change', { bubbles: true }));
      delayed.detectChanges();
      expect(view.querySelector('#municipio')).toBeNull();
      expect(view.textContent).toContain('Carregando municípios');
      municipios$.next([{ id: 3304557, nome: 'Rio de Janeiro' }]);
      await delayed.whenStable();
      const municipio = view.querySelector<HTMLSelectElement>('#municipio')!;
      expect(municipio.disabled).toBe(false);
      expect(municipio.textContent).toContain('Rio de Janeiro');
    } finally {
      delayed.destroy();
    }
  });

  it('revela os campos sem mover o foco e permite concluir sem os opcionais', async () => {
    profileCompletionFacadeMock.loadUserForFormByUid$.mockReturnValueOnce(of({
      email: 'teste@email.com', nickname: '', gender: '', orientation: '', estado: '', municipio: '',
    }));
    const fresh = TestBed.createComponent(FinalizarCadastroComponent);
    try {
      fresh.autoDetectChanges();
      await fresh.whenStable();
      const view = fresh.nativeElement as HTMLElement;
      const nickname = view.querySelector<HTMLInputElement>('#nickname')!;
      expect(view.querySelector('#gender, #estado, #municipio, #avatar, .completion-submit, .tooltip-error')).toBeNull();
      expect(view.querySelector('h1')?.textContent).toBe('Como você quer aparecer?');
      expect(view.querySelector('.completion-scene__draft')?.textContent).not.toContain('Rascunho salvo');

      nickname.focus();
      nickname.value = 'Alex';
      nickname.dispatchEvent(new Event('input', { bubbles: true }));
      await fresh.whenStable();
      fresh.detectChanges();
      expect(document.activeElement).toBe(nickname);
      expect(view.querySelector('#estado')).toBeNull();
      expect(view.querySelector('h1')?.textContent).toBe('Alex, como você se identifica?');

      const select = async (id: string, value: string) => {
        const field = view.querySelector<HTMLSelectElement>(`#${id}`)!;
        field.value = value;
        field.dispatchEvent(new Event('change', { bubbles: true }));
        await fresh.whenStable();
        fresh.detectChanges();
      };
      const continueStep = async () => {
        view.querySelector<HTMLButtonElement>('form button[type="submit"]')!.click();
        fresh.detectChanges();
        await fresh.whenStable();
      };
      await select('gender', 'homem');
      expect(view.querySelector('#estado, #orientation')).toBeNull();
      await continueStep();
      expect(view.querySelector('h1')?.textContent).toBe('Quer acrescentar sua orientação?');
      expect(view.querySelector('.completion-summary')?.textContent).toContain('Alex · Homem');
      expect(view.querySelector('#nickname, #gender')).toBeNull();
      expect(view.querySelector('#orientation option[value="assexual"]')?.textContent?.trim()).toBe('Assexual');
      await select('orientation', 'assexual');
      const consent = view.querySelector<HTMLInputElement>('[name="showOrientationPublicly"]')!;
      expect(consent.checked).toBe(false);
      expect(view.querySelector('.completion-preview')?.textContent).not.toContain('Assexual');
      consent.click();
      fresh.detectChanges();
      expect(view.querySelector('.completion-preview')?.textContent).toContain('Assexual');
      await select('orientation', '');
      await continueStep();
      expect(view.querySelector('h1')?.textContent).toBe('Em que cidade você está?');
      expect(view.querySelector('#municipio')).toBeNull();
      await select('estado', 'RJ');
      expect(view.querySelector('.completion-submit')).toBeNull();
      await select('municipio', 'Rio de Janeiro');
      expect(view.querySelector('h1')?.textContent).toBe('Em que cidade você está?');
      await continueStep();
      expect(view.querySelector('h1')?.textContent).toBe('Seu perfil está quase pronto');
      view.querySelector<HTMLButtonElement>('.completion-submit')!.click();

      expect(profileCompletionFacadeMock.saveProfileCompletion$).toHaveBeenCalledWith(
        expect.objectContaining({ nickname: 'Alex', orientation: '', municipio: 'Rio de Janeiro' })
      );
      expect(router.navigateByUrl).toHaveBeenCalledWith('/preferencias/editar', { replaceUrl: true, info: PROFILE_COMPLETED_NAVIGATION_INFO });
    } finally {
      fresh.destroy();
    }
  });

  it('oferece duas orientações opcionais na retomada de um perfil de casal', async () => {
    profileCompletionFacadeMock.loadUserForFormByUid$.mockReturnValueOnce(of({
      email: 'teste@email.com', nickname: 'casalteste', gender: 'casal-ele-ela', orientation: '',
      estado: 'RJ', municipio: 'Rio de Janeiro',
    }));
    const reopened = TestBed.createComponent(FinalizarCadastroComponent);
    try {
      reopened.autoDetectChanges();
      await reopened.whenStable();
      const view = reopened.nativeElement as HTMLElement;
      const first = view.querySelector<HTMLSelectElement>('#partner1Orientation')!;
      const second = view.querySelector<HTMLSelectElement>('#partner2Orientation')!;
      expect(view.querySelector('#orientation, [name="showOrientationPublicly"]')).toBeNull();
      expect(view.querySelector('label[for="partner1Orientation"]')?.textContent).toContain('Orientação dele');
      expect(view.querySelector('label[for="partner2Orientation"]')?.textContent).toContain('Orientação dela');
      expect(view.querySelector('form button[type="submit"]')?.textContent).toContain('Pular');
      expect(first.value).toBe('');
      second.value = 'assexual';
      second.dispatchEvent(new Event('change', { bubbles: true }));
      reopened.detectChanges();
      expect(first.value).toBe('');
      expect(view.querySelector('form button[type="submit"]')?.textContent).toContain('Continuar');

      reopened.componentInstance.onSubmit();
      expect(profileCompletionFacadeMock.saveProfileCompletion$).toHaveBeenCalledWith(
        expect.objectContaining({ partner1Orientation: '', partner2Orientation: 'assexual', showOrientationPublicly: false })
      );
    } finally {
      reopened.destroy();
    }
  });

  it('redireciona para as orientações ao alterar a composição do casal', () => {
    component.gender = 'casal-ele-ela';
    component.partner1Orientation = 'bissexual';
    component.partner2Orientation = 'pansexual';
    component.profileStep = 'location';
    component.editIdentity();
    component.onGenderChange('casal-ela-ela');
    component.advanceProfileStep();

    expect(component.profileStep).toBe('orientation');
    expect(component.partner1Orientation).toBe('');
    expect(component.partner2Orientation).toBe('');
  });

  it('retoma no município quando os campos anteriores estão no rascunho', async () => {
    TestBed.inject(LocalDraftService).save('profile-completion:u1', {
      nickname: 'Alex extra', gender: 'homem', estado: 'RJ',
    });
    profileCompletionFacadeMock.loadUserForFormByUid$.mockReturnValueOnce(of({
      email: 'teste@email.com', nickname: '', gender: '', orientation: '', estado: '', municipio: '',
    }));
    const reopened = TestBed.createComponent(FinalizarCadastroComponent);
    try {
      reopened.autoDetectChanges();
      await reopened.whenStable();
      const view = reopened.nativeElement as HTMLElement;
      expect(view.querySelector('.completion-summary')?.textContent).toContain('Alex extra · Homem');
      expect(view.querySelector('#nickname, #gender, #orientation')).toBeNull();
      expect(view.querySelector<HTMLSelectElement>('#estado')?.value).toBe('RJ');
      expect(view.querySelector('#municipio')).not.toBeNull();
      expect(view.querySelector('.completion-submit')).toBeNull();
      expect(view.querySelector('.completion-scene__draft')?.textContent).toContain('Rascunho salvo');
    } finally {
      reopened.destroy();
    }
  });

  it('salva conclusão do perfil e segue sem aceite adulto redundante', () => {
    component.onSubmit();

    expect(
      profileCompletionFacadeMock.saveProfileCompletion$
    ).toHaveBeenCalledWith({
      uid: 'u1',
      vm,
      nickname: 'tester',
      gender: 'homem',
      orientation: 'homossexual',
      showOrientationPublicly: false,
      estado: 'RJ',
      municipio: 'Rio de Janeiro',
    });

    expect(currentUserStoreMock.patch).toHaveBeenCalledWith({
      profileCompleted: true,
    });

    expect(errorNotificationMock.showSuccess).not.toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith(
      '/preferencias/editar',
      { replaceUrl: true, info: PROFILE_COMPLETED_NAVIGATION_INFO }
    );
    expect(component.hasUnsavedChanges()).toBe(false);
  });

  it('oferece continuar com o perfil já salvo sem repetir a gravação', async () => {
    vi.mocked(router.navigateByUrl).mockRejectedValueOnce(new Error('Navegação indisponível'));
    component.onSubmit();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.profileSaved).toBe(true);
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Seu perfil foi salvo. Não foi possível abrir');
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    button.click();
    component.onSubmit();
    await fixture.whenStable();

    expect(router.navigateByUrl).toHaveBeenCalledTimes(2);
    expect(router.navigateByUrl).toHaveBeenLastCalledWith(
      '/preferencias/editar',
      { replaceUrl: true, info: PROFILE_COMPLETED_NAVIGATION_INFO }
    );
    expect(profileCompletionFacadeMock.saveProfileCompletion$).toHaveBeenCalledTimes(1);
  });

  it('permite continuar com o perfil salvo quando a foto opcional falha', () => {
    component.avatarFile = new File(['image'], 'avatar.jpg', { type: 'image/jpeg' });
    profileCompletionFacadeMock.uploadProfileAvatarAfterSave$.mockReturnValueOnce(of({ status: 'upload_failed' }));

    component.onSubmit();
    fixture.detectChanges();

    expect(component.profileSaved).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Não foi possível enviar a foto');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    component.continueAfterProfileSave();
    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    expect(profileCompletionFacadeMock.saveProfileCompletion$).toHaveBeenCalledTimes(1);
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
      'Não foi possível finalizar o cadastro'
    );
    expect(errorNotificationMock.showError).not.toHaveBeenCalled();
  });

  it('distingue confirmação pendente de falha definitiva no salvamento', () => {
    vi.useFakeTimers();
    try {
      profileCompletionFacadeMock.saveProfileCompletion$.mockReturnValueOnce(NEVER);
      component.onSubmit();
      expect(component.isSubmitting).toBe(true);
      vi.advanceTimersByTime(15_000);
      fixture.detectChanges();

      expect(component.isSubmitting).toBe(false);
      expect(component.message).toContain('Ainda não foi possível confirmar se o perfil foi salvo');
      expect(profileCompletionFacadeMock.confirmProfileCompletion$).toHaveBeenCalledWith('u1');
      expect(currentUserStoreMock.patch).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('confere com o servidor na reconexão quando a resposta do salvamento se perde', () => {
    const response = new Subject<void>();
    profileCompletionFacadeMock.saveProfileCompletion$.mockReturnValueOnce(response);
    profileCompletionFacadeMock.confirmProfileCompletion$.mockReturnValueOnce(of(true));

    component.onSubmit();
    online$.next(false);
    response.error(Object.assign(new Error('internal'), { code: 'functions/internal' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.alert-secondary[role="status"]')?.textContent)
      .toContain('Conferindo se seu perfil foi salvo');
    expect(profileCompletionFacadeMock.confirmProfileCompletion$).not.toHaveBeenCalled();
    expect(errorNotificationMock.showSuccess).not.toHaveBeenCalled();

    online$.next(true);

    expect(profileCompletionFacadeMock.confirmProfileCompletion$).toHaveBeenCalledWith('u1');
    expect(profileCompletionFacadeMock.saveProfileCompletion$).toHaveBeenCalledTimes(1);
    expect(currentUserStoreMock.patch).toHaveBeenCalledWith({ profileCompleted: true });
    expect(component.profileSaved).toBe(true);
    expect(component.isSubmitting).toBe(false);
    expect(errorNotificationMock.showSuccess).not.toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/preferencias/editar', { replaceUrl: true, info: PROFILE_COMPLETED_NAVIGATION_INFO });
  });

  it('mantém o rascunho se a leitura de confirmação falhar', () => {
    profileCompletionFacadeMock.saveProfileCompletion$.mockReturnValueOnce(
      throwError(() => ({ code: 'functions/unavailable' }))
    );
    profileCompletionFacadeMock.confirmProfileCompletion$.mockReturnValueOnce(
      throwError(() => ({ code: 'unavailable' }))
    );
    component.orientation = 'bissexual';

    component.onSubmit();

    expect(component.message).toContain('Ainda não foi possível confirmar se o perfil foi salvo');
    const savedDraft = TestBed.inject(LocalDraftService).load('profile-completion:u1');
    expect(savedDraft).toEqual({ nickname: '', gender: 'homem', estado: 'RJ' });
    expect(component.orientation).toBe('bissexual');
    expect(component.selectedMunicipio).toBe('Rio de Janeiro');
    expect(component.isSubmitting).toBe(false);
    expect(currentUserStoreMock.patch).not.toHaveBeenCalled();
  });

  it('libera o formulário se a conexão não voltar durante a conferência', () => {
    vi.useFakeTimers();
    try {
      online$.next(false);
      profileCompletionFacadeMock.saveProfileCompletion$.mockReturnValueOnce(
        throwError(() => ({ code: 'functions/internal' }))
      );
      component.onSubmit();
      expect(component.confirmingProfile).toBe(true);

      vi.advanceTimersByTime(15_000);

      expect(component.isSubmitting).toBe(false);
      expect(component.confirmingProfile).toBe(false);
      expect(component.message).toContain('Ainda não foi possível confirmar se o perfil foi salvo');
      expect(profileCompletionFacadeMock.confirmProfileCompletion$).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancela a leitura pendente quando a conta muda e descarta a resposta antiga', () => {
    const confirmation = new Subject<boolean>();
    profileCompletionFacadeMock.saveProfileCompletion$.mockReturnValueOnce(
      throwError(() => ({ code: 'functions/unavailable' }))
    );
    profileCompletionFacadeMock.confirmProfileCompletion$.mockReturnValueOnce(confirmation);
    component.onSubmit();

    accountUid$.next('u2');
    confirmation.next(true);

    expect(component.message).toContain('A conta ativa mudou');
    expect(currentUserStoreMock.patch).not.toHaveBeenCalled();
    expect(errorNotificationMock.showSuccess).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(component.isSubmitting).toBe(false);
  });

  it('descarta municípios atrasados de um estado que deixou de estar selecionado', () => {
    const oldList = new Subject<unknown[]>();
    profileCompletionFacadeMock.getMunicipios$
      .mockReturnValueOnce(oldList)
      .mockReturnValueOnce(of([{ id: 3550308, nome: 'São Paulo' }]));

    component.selectedEstado = 'RJ';
    component.onEstadoChange();
    component.selectedEstado = 'SP';
    component.onEstadoChange();
    oldList.next([{ id: 3304557, nome: 'Rio de Janeiro' }]);

    expect(component.municipios.map((city) => city.nome)).toEqual(['São Paulo']);
  });

  it('orienta a retomar o cadastro se o backend detectar troca de conta', () => {
    profileCompletionFacadeMock.saveProfileCompletion$.mockReturnValueOnce(
      throwError(() => ({
        code: 'functions/permission-denied',
        details: { reason: 'auth/session-changed' },
      }))
    );

    component.onSubmit();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('p[role="alert"]')?.textContent)
      .toContain('A conta ativa mudou. Recarregue a página para retomar o cadastro.');
    expect(component.isSubmitting).toBe(false);
    expect(currentUserStoreMock.patch).not.toHaveBeenCalled();
    expect(profileCompletionFacadeMock.uploadProfileAvatarAfterSave$).not.toHaveBeenCalled();
    expect(profileCompletionFacadeMock.confirmProfileCompletion$).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('grava imediatamente os campos do rascunho para retomar após perda de sessão', () => {
    const draft = TestBed.inject(LocalDraftService);
    const save = vi.spyOn(draft, 'save');
    component.gender = 'mulher';

    component.persistUnsavedChanges();
    fixture.detectChanges();

    expect(save).toHaveBeenCalledWith(
      expect.stringMatching(/^profile-completion:/),
      expect.objectContaining({ gender: 'mulher' })
    );
    expect(fixture.nativeElement.querySelector('.completion-scene__draft')?.textContent).toContain('Rascunho salvo');
  });

  it('identifica e descarta alterações do onboarding', () => {
    component.gender = 'mulher';
    component.onDraftChange();

    expect(component.hasUnsavedChanges()).toBe(true);

    component.discardUnsavedChanges();
    expect(component.hasUnsavedChanges()).toBe(false);
  });

  it('renderiza erros obrigatórios como alertas inline acessíveis', () => {
    component.editIdentity();
    component.gender = '';
    component.selectedEstado = '';
    component.selectedMunicipio = '';

    component.advanceProfileStep();
    fixture.detectChanges();

    const errors = Array.from(
      fixture.nativeElement.querySelectorAll(
        '.app-field .tooltip-error'
      ) as NodeListOf<HTMLElement>
    );

    expect(errors).toHaveLength(1);
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
    component.editIdentity();
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
