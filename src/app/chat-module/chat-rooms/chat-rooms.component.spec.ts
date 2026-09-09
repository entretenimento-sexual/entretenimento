// src/app/chat-module/chat-rooms/chat-rooms.component.spec.ts
// -----------------------------------------------------------------------------
// CHAT ROOMS — REGRESSÃO DE COMPATIBILIDADE LEGADA
// -----------------------------------------------------------------------------
//
// SUPRESSÃO EXPLÍCITA:
// - removidos CurrentUserStoreService, criação de Sala, openCreateRoomModal,
//   createRoom e contadores/flags de criação de Sala ativa;
// - motivo: Comunidades são o domínio canônico de interação coletiva e esta
//   tela deve somente ler Salas antigas e permitir encerramento seguro pelo owner.
// -----------------------------------------------------------------------------

import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, firstValueFrom, of, throwError } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ChatRoomsComponent } from './chat-rooms.component';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import {
  RoomListItem,
  RoomService,
} from '../../core/services/batepapo/room-services/room.service';
import { RoomManagementService } from '../../core/services/batepapo/room-services/room-management.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';

describe('ChatRoomsComponent — compatibilidade legada', () => {
  let component: ChatRoomsComponent;
  let fixture: ComponentFixture<ChatRoomsComponent>;
  let authUidSubject: BehaviorSubject<string | null>;
  let roomServiceMock: { getRooms: Mock };
  let roomManagementMock: { closeRoom: Mock };
  let dialogOpenMock: Mock;
  let errorNotifierMock: {
    showError: Mock;
    showWarning: Mock;
    showSuccess: Mock;
  };
  let globalErrorHandlerMock: { handleError: Mock };

  function buildRoom(overrides: Partial<RoomListItem> = {}): RoomListItem {
    return {
      id: 'r1',
      roomId: 'r1',
      roomName: 'Sala antiga',
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

  beforeEach(async () => {
    authUidSubject = new BehaviorSubject<string | null>('u1');
    roomServiceMock = { getRooms: vi.fn(() => of([])) };
    roomManagementMock = {
      closeRoom: vi.fn(() =>
        of({ roomId: 'r1', status: 'closed', slotReleased: true })
      ),
    };
    dialogOpenMock = vi.fn(() => ({ afterClosed: () => of(false) }));
    errorNotifierMock = {
      showError: vi.fn(),
      showWarning: vi.fn(),
      showSuccess: vi.fn(),
    };
    globalErrorHandlerMock = { handleError: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [ChatRoomsComponent],
      providers: [
        {
          provide: AuthSessionService,
          useValue: { uid$: authUidSubject.asObservable() },
        },
        { provide: RoomService, useValue: roomServiceMock },
        { provide: RoomManagementService, useValue: roomManagementMock },
        { provide: MatDialog, useValue: { open: dialogOpenMock } },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorHandlerMock },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatRoomsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('consulta somente as Salas antigas do usuário autenticado', () => {
    expect(component).toBeTruthy();
    expect(roomServiceMock.getRooms).toHaveBeenCalledWith('u1');
  });

  it('separa registros ativos do histórico encerrado e só permite owner encerrar', async () => {
    roomServiceMock.getRooms.mockImplementation((uid: string) =>
      uid === 'u2'
        ? of([
            buildRoom({ id: 'active', roomId: 'active', createdBy: 'u2' }),
            buildRoom({ id: 'other', roomId: 'other', createdBy: 'u9' }),
            buildRoom({
              id: 'closed',
              roomId: 'closed',
              createdBy: 'u2',
              status: 'closed',
            }),
          ])
        : of([])
    );

    authUidSubject.next('u2');
    fixture.detectChanges();

    const vm = await firstValueFrom(
      component.roomsVm$.pipe(
        filter((value) => value.uid === 'u2' && !value.loading && value.rooms.length === 3),
        take(1)
      )
    );

    expect(vm.activeRooms.map((room) => room.id)).toEqual(['active', 'other']);
    expect(vm.closedRooms.map((room) => room.id)).toEqual(['closed']);
    expect(vm.rooms.find((room) => room.id === 'active')?.canClose).toBe(true);
    expect(vm.rooms.find((room) => room.id === 'other')?.canClose).toBe(false);
    expect(vm.rooms.find((room) => room.id === 'closed')?.canClose).toBe(false);
  });

  it('não consulta backend sem sessão e expõe histórico vazio', async () => {
    roomServiceMock.getRooms.mockClear();
    authUidSubject.next(null);
    fixture.detectChanges();

    const vm = await firstValueFrom(
      component.roomsVm$.pipe(
        filter((value) => value.uid === null && !value.loading),
        take(1)
      )
    );

    expect(vm.rooms).toEqual([]);
    expect(vm.activeRooms).toEqual([]);
    expect(vm.closedRooms).toEqual([]);
    expect(roomServiceMock.getRooms).not.toHaveBeenCalled();
  });

  it('mantém roomSelected apenas como binding de compatibilidade', () => {
    const emitSpy = vi.spyOn(component.roomSelected, 'emit');

    component.selectRoom('room-123');
    component.selectRoom('   ');

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('room-123');
  });

  it('confirma e encerra uma Sala antiga somente pela callable', () => {
    dialogOpenMock.mockReturnValue({ afterClosed: () => of(true) });
    const room = {
      ...buildRoom(),
      isOwner: true,
      canClose: true,
    };

    component.closeRoom(room);

    expect(dialogOpenMock).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        data: expect.objectContaining({ title: 'Encerrar sala antiga?' }),
      })
    );
    expect(roomManagementMock.closeRoom).toHaveBeenCalledWith('r1');
    expect(errorNotifierMock.showSuccess).toHaveBeenCalledWith(
      'Sala antiga encerrada com segurança.'
    );
  });

  it('não encerra quando o usuário cancela ou não é owner elegível', () => {
    const ownerRoom = {
      ...buildRoom(),
      isOwner: true,
      canClose: true,
    };
    const participantRoom = {
      ...buildRoom({ id: 'r2', roomId: 'r2', createdBy: 'u2' }),
      isOwner: false,
      canClose: false,
    };

    component.closeRoom(ownerRoom);
    component.closeRoom(participantRoom);

    expect(roomManagementMock.closeRoom).not.toHaveBeenCalled();
  });

  it('centraliza erro quando a leitura do legado falha', async () => {
    roomServiceMock.getRooms.mockImplementation((uid: string) =>
      uid === 'u2'
        ? throwError(() => new Error('permission-denied'))
        : of([])
    );

    authUidSubject.next('u2');
    fixture.detectChanges();

    const vm = await firstValueFrom(
      component.roomsVm$.pipe(
        filter((value) => value.uid === 'u2' && !value.loading && value.loadFailed),
        take(1)
      )
    );

    expect(vm.loadFailed).toBe(true);
    expect(errorNotifierMock.showError).toHaveBeenCalledWith(
      'Erro ao carregar suas salas antigas.'
    );
    expect(globalErrorHandlerMock.handleError).toHaveBeenCalled();
  });
});
