import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';

import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { RoomFirestoreGateway } from './room-firestore.gateway';
import { RoomService } from './room.service';

const roomGatewayMock = {
  fetchOwnedRooms$: vi.fn(),
  watchOwnedRooms$: vi.fn(),
  watchMemberRooms$: vi.fn(),
  watchRoom$: vi.fn(),
};

type RoomSpecItem = {
  id: string;
  roomName: string;
  participants: string[];
};

describe('RoomService', () => {
  let service: RoomService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      providers: [
        RoomService,
        { provide: RoomFirestoreGateway, useValue: roomGatewayMock },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    });

    service = TestBed.inject(RoomService);
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  it('countUserRooms retorna a contagem de salas ativas', async () => {
    roomGatewayMock.fetchOwnedRooms$.mockReturnValueOnce(
      of([
        { status: 'active' },
        { status: 'archived' },
        {},
      ])
    );

    await expect(service.countUserRooms('u1')).resolves.toBe(2);
    expect(roomGatewayMock.fetchOwnedRooms$).toHaveBeenCalledWith('u1');
  });

  it('getUserRooms emite lista owner-only normalizada', async () => {
    roomGatewayMock.watchOwnedRooms$.mockReturnValueOnce(
      of([
        {
          id: 'r1',
          roomName: 'Sala 1',
          createdBy: 'u1',
          participants: ['u1'],
        },
        {
          id: 'r2',
          roomName: 'Sala 2',
          createdBy: 'u1',
          participants: ['u1', 'u2'],
        },
      ])
    );

    const rooms = await firstValueFrom(
      service.getUserRooms('u1')
    ) as RoomSpecItem[];

    expect(roomGatewayMock.watchOwnedRooms$).toHaveBeenCalledWith('u1');
    expect(rooms).toHaveLength(2);
    expect(rooms[0].id).toBe('r1');
    expect(rooms[0].roomName).toBe('Sala 1');
    expect(rooms[1].participants).toEqual(['u1', 'u2']);
  });

  it('getRooms emite lista por membership', async () => {
    roomGatewayMock.watchMemberRooms$.mockReturnValueOnce(
      of([
        {
          id: 'r10',
          roomName: 'Sala A',
          createdBy: 'u9',
          participants: ['u1', 'u9'],
        },
      ])
    );

    const rooms = await firstValueFrom(
      service.getRooms('u1')
    ) as RoomSpecItem[];

    expect(roomGatewayMock.watchMemberRooms$).toHaveBeenCalledWith('u1');
    expect(rooms).toHaveLength(1);
    expect(rooms[0].id).toBe('r10');
    expect(rooms[0].participants).toEqual(['u1', 'u9']);
  });

  it('getRoomById emite documento único', async () => {
    roomGatewayMock.watchRoom$.mockReturnValueOnce(
      of({
        id: 'room-xyz',
        roomName: 'X',
        createdBy: 'u9',
        participants: ['a', 'b'],
      })
    );

    const room = await firstValueFrom(
      service.getRoomById('room-xyz')
    ) as RoomSpecItem;

    expect(roomGatewayMock.watchRoom$).toHaveBeenCalledWith('room-xyz');
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
    await expect(
      firstValueFrom(service.getRoomById(''))
    ).rejects.toThrow('roomId ausente para consulta da sala.');
  });
});
