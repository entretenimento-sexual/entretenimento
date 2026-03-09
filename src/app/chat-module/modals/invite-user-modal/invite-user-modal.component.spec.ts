// src/app/chat-module/modals/invite-user-modal/invite-user-modal.component.spec.ts
// Testes do InviteUserModalComponent
//
// Ajustes desta versão:
// - usa AuthSessionService como fonte canônica do UID
// - usa CurrentUserStoreService como fonte do perfil do app
// - corrige imports para caminhos relativos
// - evita matchers incompatíveis com typings Jasmine
// - usa jasmine.any(...) em vez de expect.any(...)
// - valida chamadas via mock.calls em vez de toHaveBeenNthCalledWith

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Timestamp } from 'firebase/firestore';

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

  let dialogRefMock: {
    close: jest.Mock;
  };

  let authSessionMock: {
    uid$: any;
    currentAuthUser: { uid: string } | null;
  };

  let currentUserStoreMock: {
    user$: any;
    getSnapshot?: jest.Mock;
  };

  let ibgeStub: {
    getEstados: jest.Mock;
    getMunicipios: jest.Mock;
  };

  let regionFilterStub: {
    getUserRegion: jest.Mock;
  };

  let inviteSearchStub: {
    searchEligibleUsers: jest.Mock;
  };

  let inviteServiceStub: {
    createInvite: jest.Mock;
  };

  let globalErrorHandlerMock: {
    handleError: jest.Mock;
  };

  let errorNotifierMock: {
    showError: jest.Mock;
    showWarning: jest.Mock;
    showInfo: jest.Mock;
  };

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
      imports: [
        InviteUserModalComponent,
        NoopAnimationsModule,
      ],
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

  it('deve carregar estados no init', () => {
    expect(ibgeStub.getEstados).toHaveBeenCalled();
    expect(component.availableStates).toEqual(['SP', 'RJ']);
  });

  it('deve obter a região do usuário autenticado no init', () => {
    expect(regionFilterStub.getUserRegion).toHaveBeenCalledWith('uid-123');
    expect(component.selectedRegion).toEqual({
      uf: 'SP',
      city: 'São Paulo',
    });
  });

  it('deve carregar municípios ao definir UF', () => {
    expect(ibgeStub.getMunicipios).toHaveBeenCalledWith('SP');
    expect(component.availableCities).toEqual(['São Paulo', 'Rio de Janeiro']);
  });

  it('deve carregar usuários elegíveis no init', () => {
    expect(inviteSearchStub.searchEligibleUsers).toHaveBeenCalled();
  });

  it('deve permitir edição de região para role diferente de visitante/free', () => {
    expect(component.isRegionFieldEditable()).toBe(true);
  });

  it('deve bloquear edição de região para role visitante', () => {
    currentUserSubject.next({
      uid: 'uid-123',
      role: 'visitante',
    });

    fixture.detectChanges();

    expect(component.isRegionFieldEditable()).toBe(false);
  });

  it('deve bloquear edição de região para role free', () => {
    currentUserSubject.next({
      uid: 'uid-123',
      role: 'free',
    });

    fixture.detectChanges();

    expect(component.isRegionFieldEditable()).toBe(false);
  });

  it('deve alternar seleção do usuário', () => {
    const user = { selected: false };

    component.toggleUserSelection(user);

    expect(user.selected).toBe(true);
  });

  it('deve retornar true quando houver usuário selecionado', () => {
    component.availableUsers = [
      { id: 'u1', nickname: 'A', selected: false },
      { id: 'u2', nickname: 'B', selected: true },
    ];

    expect(component.isAnyUserSelected()).toBe(true);
  });

  it('deve retornar false quando não houver usuário selecionado', () => {
    component.availableUsers = [
      { id: 'u1', nickname: 'A', selected: false },
      { id: 'u2', nickname: 'B', selected: false },
    ];

    expect(component.isAnyUserSelected()).toBe(false);
  });

  it('deve mostrar erro ao confirmar seleção sem usuário autenticado', () => {
    authUidSubject.next(null);
    fixture.detectChanges();

    component.confirmSelection();

    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Erro: usuário não autenticado.'
    );
  });

  it('deve mostrar warning quando nenhum usuário estiver selecionado', () => {
    component.availableUsers = [
      { id: 'u1', nickname: 'A', selected: false },
      { id: 'u2', nickname: 'B', selected: false },
    ];

    component.confirmSelection();

    expect(errorNotifierMock.showWarning).toHaveBeenCalledWith(
      'Selecione pelo menos um usuário para enviar convite.'
    );
  });

  it('deve enviar convites para usuários selecionados e fechar o modal', () => {
    component.availableUsers = [
      { id: 'u1', nickname: 'A', selected: true },
      { id: 'u2', nickname: 'B', selected: false },
      { id: 'u3', nickname: 'C', selected: true },
    ];

    component.confirmSelection();

    expect(inviteServiceStub.createInvite).toHaveBeenCalledTimes(2);

    const firstCall = inviteServiceStub.createInvite.mock.calls[0][0];
    const secondCall = inviteServiceStub.createInvite.mock.calls[1][0];

    expect(firstCall).toEqual({
      roomId: 'r1',
      roomName: 'Sala',
      receiverId: 'u1',
      senderId: 'uid-123',
      status: 'pending',
      sentAt: jasmine.any(Timestamp),
      expiresAt: jasmine.any(Timestamp),
    });

    expect(secondCall).toEqual({
      roomId: 'r1',
      roomName: 'Sala',
      receiverId: 'u3',
      senderId: 'uid-123',
      status: 'pending',
      sentAt: jasmine.any(Timestamp),
      expiresAt: jasmine.any(Timestamp),
    });

    expect(dialogRefMock.close).toHaveBeenCalledWith(['u1', 'u3']);
  });
});
