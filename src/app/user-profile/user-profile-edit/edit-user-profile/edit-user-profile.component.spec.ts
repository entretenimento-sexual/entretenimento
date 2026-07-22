// src/app/user-profile/user-profile-edit/edit-user-profile/edit-user-profile.component.spec.ts
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { EditUserProfileComponent } from './edit-user-profile.component';
import { FirestoreUserQueryService } from '../../../core/services/data-handling/firestore-user-query.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';
import { StorageService } from '../../../core/services/image-handling/storage.service';
import { UsuarioService } from '../../../core/services/user-profile/usuario.service';

describe('EditUserProfileComponent', () => {
  let component: EditUserProfileComponent;
  let fixture: ComponentFixture<EditUserProfileComponent>;
  let usuarioServiceMock: {
    atualizarUsuario: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          json: () => Promise.resolve([]),
        })
      )
    );

    usuarioServiceMock = {
      atualizarUsuario: vi.fn(() => of(void 0)),
    };

    TestBed.configureTestingModule({
      declarations: [EditUserProfileComponent],
      imports: [ReactiveFormsModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: 'u1' }),
            },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(() => Promise.resolve(true)),
          },
        },
        {
          provide: FirestoreUserQueryService,
          useValue: {
            getUser: vi.fn(() =>
              of({
                uid: 'u1',
                nickname: 'Usuário',
                estado: 'RJ',
                municipio: 'Rio de Janeiro',
                gender: 'homem',
                descricao: '',
              })
            ),
          },
        },
        {
          provide: UsuarioService,
          useValue: usuarioServiceMock,
        },
        {
          provide: StorageService,
          useValue: {
            uploadProfileAvatar: vi.fn(() => of('avatar-url')),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showSuccess: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(EditUserProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('identifica alteração não salva e permite descartá-la', () => {
    component.editForm.controls['descricao'].setValue('Nova descrição');
    component.editForm.markAsDirty();

    expect(component.hasUnsavedChanges()).toBe(true);

    component.discardUnsavedChanges();
    expect(component.hasUnsavedChanges()).toBe(false);
  });

  it('salva dados pessoais sem depender de redes sociais', () => {
    component.editForm.controls['descricao'].setValue('Descrição salva');
    component.editForm.markAsDirty();

    component.onSubmit();

    expect(usuarioServiceMock.atualizarUsuario).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ descricao: 'Descrição salva' })
    );
    expect(component.hasUnsavedChanges()).toBe(false);
  });

  it('não mantém controles ou seção duplicada de redes sociais', () => {
    const socialControlNames = [
      'instagram',
      'facebook',
      'twitter',
      'onlyfans',
      'privacy',
      'linktree',
    ];
    const text = fixture.nativeElement.textContent as string;

    socialControlNames.forEach((controlName) => {
      expect(component.editForm.contains(controlName)).toBe(false);
    });
    expect(text).not.toContain('Minhas redes sociais');
  });
});
