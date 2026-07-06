// src/app/chat-module/chat-rooms/chat-rooms.component.spec.ts
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ChatRoomsComponent } from './chat-rooms.component';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import {
  RoomListItem,
  RoomService,
} from '../../core/services/batepapo/room-services/room.service';
import { RoomManagementService } from '../../core/services/batepapo/room-services/room-management.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';

describe('ChatRoomsComponent', () => {
  let component: ChatRoomsComponent;
  let fixture: ComponentFixture<ChatRoomsComponent>;

  let authUidSubject: BehaviorSubject<string | null>;
  let currentUserSubject: BehaviorSubject<any>;

  let matDialogMock: {
    open: Mock;
  };

  let authSessionMock: {
    uid$: ReturnType<BehaviorSubject<string | null>['asObservable']>;
    whenReady: Mock;
  };

  let currentUserStoreMock: {
    user$: ReturnType<BehaviorSubject<any>['asObservable']>;
    getSnapshot: Mock;
  };

  let roomServiceMock: {
    getRooms: Mock;
  };

  let roomManagementMock: {
    createRoom: Mock;
  };

  let errorNotifierMock: {
    showError: Mock;
    showWarning: Mock;
    showInfo: Mock;
  };

  let globalErrorHandlerMock: {
    handleError: Mock;
  };

  function buildRoom(
    overrides: Partial<RoomListItem> = {}
  ): RoomListItem {
    return {
      id: 'r1',
      roomId: 'r1',
      roomName: 'Sala de Teste',
      createdBy: 'u1',
      participants: ['u1'],
      isPrivate: true,
      roomType: 'private',
      visibility: 'hidden',
      status: 'active',
      memberCount: 1,
      membershipMode: 'invite_only',
      policyVersion: 'private-room-v1',
      ...overrides,
    } as RoomListItem;
  }

  async function readStableViewModel() {
    return firstValueFrom(
      component.roomsVm$.pipe(
        filter((viewModel) => !viewModel.loading),
        take(1)
      )
    );
  }

  async function flushAsyncFlow(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  }

  function emitUser(uid: string | null, extra: Record<string, unknown> = {}): void {
    if (!uid) {
      currentUserSubject.next(null);
      authUidSubject.next(null);
      fixture.detectChanges();
      return;
    }

    currentUserSubject.next({
      uid,
      role: 'basic',
      isSubscriber: false,
      profileCompleted: true,
      ...extra,
    });
    authUidSubject.next(uid);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    authUidSubject = new BehaviorSubject<string | null>('u1');
    currentUserSubject = new BehaviorSubject<any>({
      uid: 'u1',
      role: 'basic',
      isSubscriber: false,
      profileCompleted: true,
    });

    matDialogMock = {
      open: vi.fn(() => ({
        afterClosed: () => of(null),
      })),
    };

    authSessionMock = {
      uid$: authUidSubject.asObservable(),
      whenReady: vi.fn(() => Promise.resolve()),
    };

    currentUserStoreMock = {
      user$: currentUserSubject.asObservable(),
      getSnapshot: vi.fn(() => currentUserSubject.value),
    };

    roomServiceMock = {
      getRooms: vi.fn(() => of([])),
    };

    roomManagementMock = {
      createRoom: vi.fn(() =>
        of({
          id: 'r1',
          roomName: 'Sala de Teste',
          createdBy: 'u1',
          participants: ['u1'],
          isPrivate: true,
          roomType: 'private',
          visibility: 'hidden',
        })
      ),
    };

    errorNotifierMock = {
      showError: vi.fn(),
      showWarning: vi.fn(),
      showInfo: vi.fn(),
    };

    globalErrorHandlerMock = {
      handleError: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [ChatRoomsComponent],
      providers: [
        { provide: MatDialog, useValue: matDialogMock },
        { provide: AuthSessionService, useValue: authSessionMock },
        { provide: CurrentUserStoreService, useValue: currentUserStoreMock },
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

  it('deve ser criado', () => {
    expect(component).toBeTruthy();
  });

  it('deve consultar salas por participação do usuário autenticado', () => {
    expect(roomServiceMock.getRooms).toHaveBeenCalledWith('u1');
  });

  it('deve atualizar currentUser a partir do CurrentUserStoreService', () => {
    expect(component.currentUser).toBeTruthy();
    expect(component.currentUser?.uid).toBe('u1');
    expect(component.currentUser?.role).toBe('basic');
  });

  it('deve expor estado estável sem salas quando a consulta retorna vazia', async () => {
    const viewModel = await readStableViewModel();

    expect(viewModel.uid).toBe('u1');
    expect(viewModel.rooms).toEqual([]);
    expect(viewModel.loading).toBe(false);
    expect(viewModel.loadFailed).toBe(false);
    expect(viewModel.hasOwnedActiveRoom).toBe(false);
    expect(viewModel.ownedActiveRoomCount).toBe(0);
  });

  it('deve reconhecer sala ativa administrada pelo usuário', async () => {
    roomServiceMock.getRooms.mockImplementation((uid: string) =>
      uid === 'u2'
        ? of([buildRoom({ createdBy: 'u2', participants: ['u2'] })])
        : of([])
    );

    emitUser('u2');

    const viewModel = await firstValueFrom(
      component.roomsVm$.pipe(
        filter(
          (value) =>
            value.uid === 'u2' &&
            !value.loading &&
            value.rooms.length === 1
        ),
        take(1)
      )
    );

    expect(viewModel.rooms[0]?.isOwner).toBe(true);
    expect(viewModel.hasOwnedActiveRoom).toBe(true);
    expect(viewModel.ownedActiveRoomCount).toBe(1);
  });

  it('deve emitir roomSelected ao selecionar uma sala válida', () => {
    const emitSpy = vi.spyOn(component.roomSelected, 'emit');

    component.selectRoom('room-123');

    expect(emitSpy).toHaveBeenCalledWith('room-123');
  });

  it('não deve emitir roomSelected quando roomId for vazio', () => {
    const emitSpy = vi.spyOn(component.roomSelected, 'emit');

    component.selectRoom('   ');

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('deve refletir ausência de sessão no view model', async () => {
    emitUser(null);

    const viewModel = await firstValueFrom(
      component.roomsVm$.pipe(
        filter((value) => value.uid === null && !value.loading),
        take(1)
      )
    );

    expect(viewModel.rooms).toEqual([]);
    expect(viewModel.hasOwnedActiveRoom).toBe(false);
    expect(component.currentUser).toBeNull();
  });

  it('deve mostrar warning ao tentar criar sala sem usuário autenticado', async () => {
    emitUser(null);
    currentUserStoreMock.getSnapshot.mockReturnValue(null);

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

  it('não deve bloquear localmente perfil basic sem isSubscriber quando não há sala ativa', async () => {
    currentUserStoreMock.getSnapshot.mockReturnValue({
      uid: 'u1',
      role: 'basic',
      isSubscriber: false,
      profileCompleted: true,
    });

    component.openCreateRoomModal();
    await flushAsyncFlow();

    expect(authSessionMock.whenReady).toHaveBeenCalled();
    expect(matDialogMock.open).toHaveBeenCalled();
  });

  it('deve bloquear nova criação quando já existe sala própria ativa no view model', async () => {
    roomServiceMock.getRooms.mockImplementation((uid: string) =>
      uid === 'u2'
        ? of([buildRoom({ createdBy: 'u2', participants: ['u2'] })])
        : of([])
    );

    currentUserStoreMock.getSnapshot.mockReturnValue({
      uid: 'u2',
      role: 'basic',
      isSubscriber: false,
      profileCompleted: true,
    });
    emitUser('u2');

    await firstValueFrom(
      component.roomsVm$.pipe(
        filter(
          (value) =>
            value.uid === 'u2' &&
            !value.loading &&
            value.hasOwnedActiveRoom
        ),
        take(1)
      )
    );

    vi.clearAllMocks();

    component.openCreateRoomModal();

    expect(errorNotifierMock.showInfo).toHaveBeenCalledWith(
      'Você já possui uma sala ativa criada por você.'
    );
    expect(matDialogMock.open).not.toHaveBeenCalled();
  });

  it('deve enviar a criação confirmada ao serviço backend e abrir confirmação', async () => {
    matDialogMock.open
      .mockReturnValueOnce({
        afterClosed: () =>
          of({
            success: true,
            action: 'created',
            roomDetails: {
              roomName: 'Sala Nova',
              description: 'Teste seguro',
            },
          }),
      })
      .mockReturnValueOnce({
        afterClosed: () => of(null),
      });

    component.openCreateRoomModal();
    await flushAsyncFlow();

    expect(roomManagementMock.createRoom).toHaveBeenCalledWith({
      roomName: 'Sala Nova',
      description: 'Teste seguro',
    });

    expect(matDialogMock.open).toHaveBeenCalledTimes(2);
  });

  it('deve apresentar falha de carregamento quando a leitura de salas falhar', async () => {
    roomServiceMock.getRooms.mockImplementation((uid: string) =>
      uid === 'u2'
        ? throwError(() => new Error('permission-denied'))
        : of([])
    );

    emitUser('u2', { isSubscriber: false });

    const viewModel = await firstValueFrom(
      component.roomsVm$.pipe(
        filter(
          (value) =>
            value.uid === 'u2' &&
            !value.loading &&
            value.loadFailed
        ),
        take(1)
      )
    );

    expect(viewModel.loadFailed).toBe(true);
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Erro ao carregar suas salas.'
    );
    expect(globalErrorHandlerMock.handleError).toHaveBeenCalled();
  });
});
