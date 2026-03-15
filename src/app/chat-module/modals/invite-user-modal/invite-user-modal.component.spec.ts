import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { InviteUserModalComponent } from './invite-user-modal.component';

import { AuthSessionService } from '../../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../../core/services/autentication/auth/current-user-store.service';
import { IBGELocationService } from '../../../core/services/general/api/ibge-location.service';
import { RegionFilterService } from '../../../core/services/filtering/filters/region-filter.service';
import { InviteSearchService } from '../../../core/services/batepapo/invite-service/invite-search.service';
import { InviteService } from '../../../core/services/batepapo/invite-service/invite.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';

describe('InviteUserModalComponent', () => {
  let fixture: ComponentFixture<InviteUserModalComponent>;
  let component: InviteUserModalComponent;

  let authUidSubject: BehaviorSubject<string | null>;
  let currentUserSubject: BehaviorSubject<any>;

  let dialogRefMock: { close: jest.Mock };
  let authSessionMock: { uid$: ReturnType<BehaviorSubject<string | null>['asObservable']>; currentAuthUser: { uid: string } | null };
  let currentUserStoreMock: { user$: ReturnType<BehaviorSubject<any>['asObservable']>; getSnapshot: jest.Mock };

  let ibgeStub: { getEstados: jest.Mock; getMunicipios: jest.Mock };
  let regionFilterStub: { getUserRegion: jest.Mock };
  let inviteSearchStub: { searchEligibleUsers: jest.Mock };
  let inviteServiceStub: { createInvite: jest.Mock };
  let globalErrorHandlerMock: { handleError: jest.Mock };
  let errorNotifierMock: { showError: jest.Mock; showWarning: jest.Mock; showInfo: jest.Mock };

  beforeEach(async () => {
    authUidSubject = new BehaviorSubject<string | null>('uid-123');

    currentUserSubject = new BehaviorSubject<any>({
      uid: 'uid-123',
      role: 'admin',
      nickname: 'Usuário Teste',
      isSubscriber: true,
    });

    dialogRefMock = {
      close: jest.fn(),
    };

    authSessionMock = {
      uid$: authUidSubject.asObservable(),
      currentAuthUser: { uid: 'uid-123' },
    };

    currentUserStoreMock = {
      user$: currentUserSubject.asObservable(),
      getSnapshot: jest.fn(() => currentUserSubject.value),
    };

    ibgeStub = {
      getEstados: jest.fn(() => of([{ sigla: 'SP' }, { sigla: 'RJ' }])),
      getMunicipios: jest.fn(() => of([{ nome: 'São Paulo' }, { nome: 'Rio de Janeiro' }])),
    };

    regionFilterStub = {
      getUserRegion: jest.fn(() => of({ uf: 'SP', city: 'São Paulo' })),
    };

    inviteSearchStub = {
      searchEligibleUsers: jest.fn(() => of([])),
    };

    inviteServiceStub = {
      createInvite: jest.fn(() => of(void 0)),
    };

    globalErrorHandlerMock = {
      handleError: jest.fn(),
    };

    errorNotifierMock = {
      showError: jest.fn(),
      showWarning: jest.fn(),
      showInfo: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [InviteUserModalComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MAT_DIALOG_DATA, useValue: { roomId: 'r1', roomName: 'Sala' } },
        { provide: AuthSessionService, useValue: authSessionMock },
        { provide: CurrentUserStoreService, useValue: currentUserStoreMock },
        { provide: IBGELocationService, useValue: ibgeStub },
        { provide: RegionFilterService, useValue: regionFilterStub },
        { provide: InviteSearchService, useValue: inviteSearchStub },
        { provide: InviteService, useValue: inviteServiceStub },
        { provide: GlobalErrorHandlerService, useValue: globalErrorHandlerMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(InviteUserModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
