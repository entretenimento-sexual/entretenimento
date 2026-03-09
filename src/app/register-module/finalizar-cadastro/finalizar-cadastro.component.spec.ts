// src/app/register-module/finalizar-cadastro/finalizar-cadastro.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { FinalizarCadastroComponent } from './finalizar-cadastro.component';

import { EmailVerificationService } from '../../core/services/autentication/register/email-verification.service';
import { IBGELocationService } from '../../core/services/general/api/ibge-location.service';
import { FirestoreUserQueryService } from '../../core/services/data-handling/firestore-user-query.service';
import { FirestoreUserWriteService } from '../../core/services/data-handling/firestore-user-write.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { StorageService } from '../../core/services/image-handling/storage.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';

describe('FinalizarCadastroComponent', () => {
  let fixture: ComponentFixture<FinalizarCadastroComponent>;
  let component: FinalizarCadastroComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [FinalizarCadastroComponent],
      imports: [
        RouterTestingModule,
        FormsModule,
        CommonModule,
      ],
      providers: [
        {
          provide: EmailVerificationService,
          useValue: {
            reloadCurrentUser: () => of(true),
          },
        },
        {
          provide: IBGELocationService,
          useValue: {
            getEstados: () => of([]),
            getMunicipios: () => of([]),
          },
        },
        {
          provide: FirestoreUserQueryService,
          useValue: {
            getUser: () =>
              of({
                uid: 'u1',
                email: 'teste@email.com',
                nickname: 'tester',
                isSubscriber: false,
                firstLogin: Date.now(),
                registrationDate: Date.now(),
                acceptedTerms: {
                  accepted: true,
                  date: Date.now(),
                },
              }),
          },
        },
        {
          provide: FirestoreUserWriteService,
          useValue: {
            saveInitialUserData$: () => of(void 0),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of({
              uid: 'u1',
              email: 'teste@email.com',
              nickname: 'tester',
            }),
            getLoggedUserUID$: () => of('u1'),
            set: jasmine.createSpy('set'),
          },
        },
        {
          provide: StorageService,
          useValue: {
            uploadProfileAvatar: () => of(null),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: jasmine.createSpy('handleError'),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: jasmine.createSpy('showError'),
            showSuccess: jasmine.createSpy('showSuccess'),
            showWarning: jasmine.createSpy('showWarning'),
            showInfo: jasmine.createSpy('showInfo'),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(FinalizarCadastroComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
