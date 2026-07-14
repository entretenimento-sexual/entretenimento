import { TestBed } from '@angular/core/testing';
import { firstValueFrom, from, of } from 'rxjs';

const { firestoreMocks } = vi.hoisted(() => ({
  firestoreMocks: {
    Firestore: class FirestoreMock {},
    collection: vi.fn(() => ({ kind: 'collection' })),
    collectionData: vi.fn(),
    doc: vi.fn(() => ({ kind: 'doc' })),
    docData: vi.fn(),
    getDocs: vi.fn(),
    limit: vi.fn((value: number) => ({ kind: 'limit', value })),
    query: vi.fn(() => ({ kind: 'query' })),
    where: vi.fn(() => ({ kind: 'where' })),
  },
}));

vi.mock('@angular/fire/firestore', () => firestoreMocks);

import { Firestore } from '@angular/fire/firestore';
import { FirestoreContextService } from '../../data-handling/firestore/core/firestore-context.service';
import { GlobalErrorHandlerService } from '../../error-handler/global-error-handler.service';
import { RoomService } from './room.service';

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

    firestoreMocks.collection.mockReturnValue({ kind: 'collection' });
    firestoreMocks.doc.mockReturnValue({ kind: 'doc' });
    firestoreMocks.limit.mockImplementation((value: number) => ({
      kind: 'limit',
      value,
    }));
    firestoreMocks.query.mockReturnValue({ kind: 'query' });
    firestoreMocks.where.mockReturnValue({ kind: 'where' });

    TestBed.configureTestingModule({
      providers: [
        RoomService,
        { provide: Firestore, useValue: {} },
        {
          provide: FirestoreContextService,
          useValue: {
            deferPromise$: (task: () => Promise<unknown>) => from(task()),
            deferObservable$: (task: () => unknown) => task(),
          },
        },
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
    firestoreMocks.getDocs.mockResolvedValue({
      docs: [
        { data: () => ({ status: 'active' }) },
        { data: () => ({ status: 'archived' }) },
        { data: () => ({}) },
      ],
    });

    await expect(service.countUserRooms('u1')).resolves.toBe(2);
    expect(firestoreMocks.getDocs).toHaveBeenCalledOnce();
  });

  it('getUserRooms emite lista owner-only normalizada', async () => {
    firestoreMocks.collectionData.mockReturnValueOnce(
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

    expect(rooms).toHaveLength(2);
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

    const rooms = await firstValueFrom(
      service.getRooms('u1')
    ) as RoomSpecItem[];

    expect(rooms).toHaveLength(1);
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

    const room = await firstValueFrom(
      service.getRoomById('room-xyz')
    ) as RoomSpecItem;

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
