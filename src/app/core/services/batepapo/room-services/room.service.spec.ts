// src/app/core/services/batepapo/room-services/room.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { describe, beforeEach, it, expect, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  Firestore: class FirestoreMock {},
  collection: vi.fn(() => ({ kind: 'collection' })),
  collectionData: vi.fn(),
  doc: vi.fn(() => ({ kind: 'doc' })),
  docData: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn((value: number) => ({ kind: 'limit', value })),
  query: vi.fn((_ref: unknown, ...constraints: unknown[]) => ({ kind: 'query', constraints })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value })),
}));

vi.mock('@angular/fire/firestore', () => firestoreMocks);

import { Firestore } from '@angular/fire/firestore';
import { RoomService } from './room.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { FirestoreContextService } from '../../data-handling/firestore/core/firestore-context.service';

describe('RoomService', () => {
  let service: RoomService;

  let globalErrorMock: {
    handleError: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    globalErrorMock = {
      handleError: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        RoomService,
        { provide: Firestore, useValue: {} },
        {
          provide: FirestoreContextService,
          useValue: {
            deferPromise$: (task: () => Promise<unknown>) => of(task()),
            deferObservable$: (task: () => unknown) => task(),
          },
        },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });

    service = TestBed.inject(RoomService);
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('countUserRooms retorna a contagem de salas ativas', async () => {
    firestoreMocks.getDocs.mockResolvedValue({
      docs: [
        { id: 'r1', data: () => ({ status: 'active' }) },
        { id: 'r2', data: () => ({ status: 'archived' }) },
        { id: 'r3', data: () => ({}) },
      ],
    });

    const total = await service.countUserRooms('u1');

    expect(total).toBe(2);
    expect(firestoreMocks.getDocs).toHaveBeenCalled();
  });

  it('getUserRooms emite lista owner-only normalizada', async () => {
    firestoreMocks.collectionData.mockReturnValueOnce(
      of([
        {
          id: 'r1',
          roomName: 'Sala 1',
          createdBy: 'u1',
          participants: ['u1'],
          lastActivity: new Date('2026-01-01T10:00:00Z'),
        },
        {
          id: 'r2',
          roomName: 'Sala 2',
          createdBy: 'u1',
          participants: ['u1', 'u2'],
          lastActivity: new Date('2026-01-01T09:00:00Z'),
        },
      ])
    );

    const rooms = await firstValueFrom(service.getUserRooms('u1'));

    expect(rooms.length).toBe(2);
    expect(rooms[0].id).toBe('r1');
    expect(rooms[0].roomName).toBe('Sala 1');
    expect(rooms[1].participants).toEqual(['u1', 'u2']);
  });

  it('getRooms emite lista por membership', async () => {
    firestoreMocks.collectionData.mockReturnValueOnce(
      of([
        {
          id: 'r10',
          roomName: 'Sala A',
          createdBy: 'u9',
          participants: ['u1', 'u9'],
        },
      ])
    );

    const rooms = await firstValueFrom(service.getRooms('u1'));

    expect(rooms.length).toBe(1);
    expect(rooms[0].id).toBe('r10');
    expect(rooms[0].participants).toEqual(['u1', 'u9']);
  });

  it('getRoomById emite documento único', async () => {
    firestoreMocks.docData.mockReturnValueOnce(
      of({
        id: 'room-xyz',
        roomName: 'X',
        createdBy: 'u9',
        participants: ['a', 'b'],
      })
    );

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
      'roomId ausente para consulta da sala.'
    );
  });
});
