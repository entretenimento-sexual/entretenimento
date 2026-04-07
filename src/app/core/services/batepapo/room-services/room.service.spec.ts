// src/app/core/services/batepapo/room-services/room.service.spec.ts
// Testes unitários do RoomService
// Ajustes desta versão:
// - instancia o service via TestBed, porque ele usa inject()
// - evita matchers que quebram com tipagem Jasmine
// - mantém Jest no runner, mas com asserts compatíveis
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { describe, beforeEach, it, expect, vi, type Mock } from 'vitest';

import { RoomService } from './room.service';
import { ErrorNotificationService } from '../../error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import * as ffs from 'firebase/firestore';
import { Firestore } from '@angular/fire/firestore';

describe('RoomService (unit)', () => {
  let service: RoomService;

  let errorNotifierMock: {
    showError: Mock;
  };

  let globalErrorMock: {
    handleError: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    errorNotifierMock = {
      showError: vi.fn(),
    };

    globalErrorMock = {
      handleError: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        RoomService,
        { provide: Firestore, useValue: {} },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });

    service = TestBed.inject(RoomService);
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('countUserRooms retorna a contagem', async () => {
    (ffs.getDocs as Mock).mockResolvedValue({
      docs: [
        { id: 'r1', data: () => ({}) },
        { id: 'r2', data: () => ({}) },
      ],
    });

    const total = await service.countUserRooms('u1');

    expect(total).toBe(2);
    expect(ffs.getDocs).toHaveBeenCalled();
  });

  it('getUserRooms emite lista', async () => {
    const snapshot = {
      docs: [
        {
          id: 'r1',
          data: () => ({
            roomName: 'Sala 1',
            createdBy: 'u1',
            participants: ['u1'],
            timestamp: new Date(),
          }),
        },
        {
          id: 'r2',
          data: () => ({
            roomName: 'Sala 2',
            createdBy: 'u2',
            participants: ['u1', 'u2'],
            timestamp: new Date(),
          }),
        },
      ],
    } as any;

    (ffs.onSnapshot as Mock).mockImplementation((_q: any, next: Function) => {
      next(snapshot);
      return vi.fn();
    });

    const rooms = await firstValueFrom(service.getUserRooms('u1'));

    expect(rooms.length).toBe(2);
    expect(rooms[0].id).toBe('r1');
    expect(rooms[0].roomName).toBe('Sala 1');
    expect(rooms[1].participants).toEqual(['u1', 'u2']);
  });

  it('getRooms emite lista', async () => {
    const snapshot = {
      docs: [
        {
          id: 'r10',
          data: () => ({
            roomName: 'Sala A',
            createdBy: 'u9',
            participants: ['u1', 'u9'],
            timestamp: new Date(),
          }),
        },
      ],
    } as any;

    (ffs.onSnapshot as Mock).mockImplementation((_q: any, next: Function) => {
      next(snapshot);
      return vi.fn();
    });

    const rooms = await firstValueFrom(service.getRooms('u1'));

    expect(rooms.length).toBe(1);
    expect(rooms[0].id).toBe('r10');
    expect(rooms[0].participants).toEqual(['u1', 'u9']);
  });

  it('getRoomById emite documento único', async () => {
    const docSnap = {
      id: 'room-xyz',
      exists: () => true,
      data: () => ({
        roomName: 'X',
        createdBy: 'u9',
        participants: ['a', 'b'],
        timestamp: new Date(),
      }),
    } as any;

    (ffs.onSnapshot as Mock).mockImplementation((_ref: any, next: Function) => {
      next(docSnap);
      return vi.fn();
    });

    const room = await firstValueFrom(service.getRoomById('room-xyz'));

    expect(room.id).toBe('room-xyz');
    expect(room.roomName).toBe('X');
    expect(room.participants).toEqual(['a', 'b']);
  });

it('deve falhar ao contar salas sem uid', async () => {
  await expect(service.countUserRooms('')).rejects.toThrow(
    'UID ausente para consulta de salas.'
  );
});

it('deve falhar ao buscar roomId vazio', async () => {
  await expect(firstValueFrom(service.getRoomById(''))).rejects.toThrow(
    'roomId ausente.'
  );
});
})
