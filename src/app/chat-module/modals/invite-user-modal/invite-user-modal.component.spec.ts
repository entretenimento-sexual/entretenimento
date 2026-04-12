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
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

describe('InviteUserModalComponent', () => {
  let fixture: ComponentFixture<InviteUserModalComponent>;
  let component: InviteUserModalComponent;

  let authUidSubject: BehaviorSubject<string | null>;
  let currentUserSubject: BehaviorSubject<any>;

  let dialogRefMock: { close: Mock };
  let authSessionMock: { uid$: ReturnType<BehaviorSubject<string | null>['asObservable']>; currentAuthUser: { uid: string } | null };
  let currentUserStoreMock: { user$: ReturnType<BehaviorSubject<any>['asObservable']>; getSnapshot: Mock };

  let ibgeStub: { getEstados: Mock; getMunicipios: Mock };
  let regionFilterStub: { getUserRegion: Mock };
  let inviteSearchStub: { searchEligibleUsers: Mock };
  let inviteServiceStub: { createInvite: Mock };
  let globalErrorHandlerMock: { handleError: Mock };
  let errorNotifierMock: { showError: Mock; showWarning: Mock; showInfo: Mock };

  beforeEach(async () => {
    authUidSubject = new BehaviorSubject<string | null>('uid-123');

    currentUserSubject = new BehaviorSubject<any>({
      uid: 'uid-123',
      role: 'admin',
      nickname: 'Usuário Teste',
      isSubscriber: true,
    });

    dialogRefMock = {
      close: vi.fn(),
    };

    authSessionMock = {
      uid$: authUidSubject.asObservable(),
      currentAuthUser: { uid: 'uid-123' },
    };

    currentUserStoreMock = {
      user$: currentUserSubject.asObservable(),
      getSnapshot: vi.fn(() => currentUserSubject.value),
    };

    ibgeStub = {
      getEstados: vi.fn(() => of([{ sigla: 'SP' }, { sigla: 'RJ' }])),
      getMunicipios: vi.fn(() => of([{ nome: 'São Paulo' }, { nome: 'Rio de Janeiro' }])),
    };

    regionFilterStub = {
      getUserRegion: vi.fn(() => of({ uf: 'SP', city: 'São Paulo' })),
    };

    inviteSearchStub = {
      searchEligibleUsers: vi.fn(() => of([])),
    };

    inviteServiceStub = {
      createInvite: vi.fn(() => of(void 0)),
    };

    globalErrorHandlerMock = {
      handleError: vi.fn(),
    };

    errorNotifierMock = {
      showError: vi.fn(),
      showWarning: vi.fn(),
      showInfo: vi.fn(),
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
