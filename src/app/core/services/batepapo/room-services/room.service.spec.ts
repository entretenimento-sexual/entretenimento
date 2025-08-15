// src/app/core/services/batepapo/room-services/room.service.spec.ts
import { RoomService } from './room.service';
import * as ffs from 'firebase/firestore';
import { IRoom as Room } from '../../../interfaces/interfaces-chat/room.interface';

describe('RoomService (unit)', () => {
  let service: RoomService;
  const errorNotifier = { showError: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new RoomService({} as any, errorNotifier as any);
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('countUserRooms retorna a contagem', async () => {
    (ffs.getDocs as jest.Mock).mockResolvedValue({
      docs: [{ id: 'r1', data: () => ({}) }, { id: 'r2', data: () => ({}) }],
    });
    const total = await service.countUserRooms('u1');
    expect(total).toBe(2);
  });

  it('getUserRooms emite lista', (done) => {
    const snapshot = {
      docs: [
        { id: 'r1', data: () => ({ roomName: 'Sala 1', createdBy: 'u1', participants: ['u1'], timestamp: new Date() }) },
        { id: 'r2', data: () => ({ roomName: 'Sala 2', createdBy: 'u2', participants: ['u1', 'u2'], timestamp: new Date() }) },
      ],
    } as any;

    (ffs.onSnapshot as jest.Mock).mockImplementation((_q: any, next: Function) => {
      next(snapshot);
      return jest.fn();
    });

    service.getUserRooms('u1').subscribe({
      next: (rooms: Room[]) => {
        expect(rooms.length).toBe(2);
        expect(rooms[0].id).toBe('r1');
        expect(rooms[1].participants).toEqual(['u1', 'u2']);
        done();
      },
      error: done.fail,
    });
  });

  it('getRoomById emite documento único', (done) => {
    const docSnap = {
      id: 'room-xyz',
      exists: () => true,
      data: () => ({ roomName: 'X', createdBy: 'u9', participants: ['a', 'b'], timestamp: new Date() }),
    } as any;

    (ffs.onSnapshot as jest.Mock).mockImplementation((_ref: any, next: Function) => {
      next(docSnap);
      return jest.fn();
    });

    service.getRoomById('room-xyz').subscribe({
      next: (room) => {
        expect(room.id).toBe('room-xyz');
        expect(room.participants).toEqual(['a', 'b']);
        done();
      },
      error: done.fail,
    });
  });
});
