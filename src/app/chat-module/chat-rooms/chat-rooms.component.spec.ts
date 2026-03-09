// src/app/chat-module/chat-rooms/chat-rooms.component.spec.ts
// Testes do ChatRoomsComponent
//
// Ajustes desta versão:
// - usa AuthSessionService como fonte canônica de UID
// - usa CurrentUserStoreService como fonte do perfil do usuário
// - adiciona NO_ERRORS_SCHEMA para evitar ruído do template
// - mantém Jest + Angular TestBed
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';

import { ChatRoomsComponent } from './chat-rooms.component';
import { MatDialog } from '@angular/material/dialog';

import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';

import { SubscriptionService } from '../../core/services/subscriptions/subscription.service';
import { RoomService } from '../../core/services/batepapo/room-services/room.service';
import { RoomManagementService } from '../../core/services/batepapo/room-services/room-management.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';

describe('ChatRoomsComponent', () => {
  let component: ChatRoomsComponent;
  let fixture: ComponentFixture<ChatRoomsComponent>;

  // Subjects para simular streams reativos reais
  let authUidSubject: BehaviorSubject<string | null>;
  let currentUserSubject: BehaviorSubject<any>;

  // Mocks reutilizáveis
  let matDialogMock: {
    open: jest.Mock;
  };

  let authSessionMock: {
    uid$: any;
    currentAuthUser: { uid: string } | null;
  };

  let currentUserStoreMock: {
    user$: any;
    getSnapshot: jest.Mock;
  };

  let subscriptionServiceMock: {
    promptSubscription: jest.Mock;
  };

  let roomServiceMock: {
    getUserRooms: jest.Mock;
    countUserRooms: jest.Mock;
  };

  let roomManagementMock: {
    createRoom: jest.Mock;
  };

  let errorNotifierMock: {
    showError: jest.Mock;
    showWarning: jest.Mock;
    showInfo: jest.Mock;
  };

  let globalErrorHandlerMock: {
    handleError: jest.Mock;
  };

  beforeEach(async () => {
    authUidSubject = new BehaviorSubject<string | null>('u1');
    currentUserSubject = new BehaviorSubject<any>({
      uid: 'u1',
      role: 'premium',
      isSubscriber: true,
    });

    matDialogMock = {
      open: jest.fn(() => ({
        afterClosed: () => of(null),
      })),
    };

    authSessionMock = {
      uid$: authUidSubject.asObservable(),
      currentAuthUser: { uid: 'u1' },
    };

    currentUserStoreMock = {
      user$: currentUserSubject.asObservable(),
      getSnapshot: jest.fn(() => currentUserSubject.value),
    };

    subscriptionServiceMock = {
      promptSubscription: jest.fn(),
    };

    roomServiceMock = {
      getUserRooms: jest.fn(() => of([])),
      countUserRooms: jest.fn(() => Promise.resolve(0)),
    };

    roomManagementMock = {
      createRoom: jest.fn(() =>
        of({
          id: 'r1',
          roomName: 'Sala de Teste',
          createdBy: 'u1',
          participants: ['u1'],
        })
      ),
    };

    errorNotifierMock = {
      showError: jest.fn(),
      showWarning: jest.fn(),
      showInfo: jest.fn(),
    };

    globalErrorHandlerMock = {
      handleError: jest.fn(),
    };

    await TestBed.configureTestingModule({
      declarations: [ChatRoomsComponent],
      providers: [
        { provide: MatDialog, useValue: matDialogMock },
        { provide: AuthSessionService, useValue: authSessionMock },
        { provide: CurrentUserStoreService, useValue: currentUserStoreMock },
        { provide: SubscriptionService, useValue: subscriptionServiceMock },
        { provide: RoomService, useValue: roomServiceMock },
        { provide: RoomManagementService, useValue: roomManagementMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorHandlerMock },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatRoomsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('deve carregar salas quando receber UID autenticado', () => {
    expect(roomServiceMock.getUserRooms).toHaveBeenCalledWith('u1');
  });

it('deve atualizar currentUser a partir do CurrentUserStoreService', () => {
  expect(component.currentUser).toBeTruthy();
  expect(component.currentUser?.uid).toBe('u1');
  expect(component.currentUser?.role).toBe('premium');
  expect(component.currentUser?.isSubscriber).toBe(true);
});

  it('deve emitir roomSelected ao selecionar uma sala válida', () => {
    const emitSpy = jest.spyOn(component.roomSelected, 'emit');

    component.selectRoom('room-123');

    expect(emitSpy).toHaveBeenCalledWith('room-123');
  });

  it('não deve emitir roomSelected quando roomId for vazio', () => {
    const emitSpy = jest.spyOn(component.roomSelected, 'emit');

    component.selectRoom('   ');

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('deve limpar chatRooms quando uid ficar null', () => {
    component.chatRooms = [
      {
        id: 'r1',
        roomName: 'Sala 1',
        createdBy: 'u1',
        participants: ['u1'],
      } as any,
    ];

    authUidSubject.next(null);
    fixture.detectChanges();

    expect(component.chatRooms).toEqual([]);
    expect(component.currentUser).toBeNull();
  });

  it('deve mostrar warning ao tentar criar sala sem usuário autenticado', async () => {
    authUidSubject.next(null);
    currentUserSubject.next(null);
    currentUserStoreMock.getSnapshot.mockReturnValue(null);
    authSessionMock.currentAuthUser = null;

    fixture.detectChanges();

    component.openCreateRoomModal();

    expect(errorNotifierMock.showWarning).toHaveBeenCalledWith(
      'Você precisa estar logado para criar uma sala.'
    );
  });

  it('deve mostrar info quando perfil ainda estiver hidratando', () => {
    currentUserSubject.next(undefined);
    currentUserStoreMock.getSnapshot.mockReturnValue(undefined);

    fixture.detectChanges();

    component.openCreateRoomModal();

    expect(errorNotifierMock.showInfo).toHaveBeenCalledWith(
      'Aguarde o carregamento do seu perfil para criar uma sala.'
    );
  });

  it('deve bloquear criação para usuário sem assinatura e sem role premium/vip', async () => {
    currentUserSubject.next({
      uid: 'u1',
      role: 'basic',
      isSubscriber: false,
    });
    currentUserStoreMock.getSnapshot.mockReturnValue({
      uid: 'u1',
      role: 'basic',
      isSubscriber: false,
    });

    fixture.detectChanges();

    component.openCreateRoomModal();

    // aguarda microtask do Promise.resolve(countUserRooms)
    await Promise.resolve();

    expect(subscriptionServiceMock.promptSubscription).toHaveBeenCalledWith({
      title: 'Permissão necessária',
      message: 'Você precisa ser assinante ou ter um perfil premium/vip para criar salas.',
    });
  });

  it('deve mostrar info quando usuário já atingiu o limite de salas', async () => {
    roomServiceMock.countUserRooms.mockResolvedValueOnce(1);

    component.openCreateRoomModal();

    await Promise.resolve();

    expect(errorNotifierMock.showInfo).toHaveBeenCalledWith(
      'Você já atingiu o limite de salas criadas.'
    );
  });

  it('deve abrir modal de criação quando usuário puder criar sala', async () => {
    component.openCreateRoomModal();

    await Promise.resolve();

    expect(matDialogMock.open).toHaveBeenCalled();
  });
});
