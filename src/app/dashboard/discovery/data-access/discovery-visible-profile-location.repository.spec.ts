import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoveryVisibleProfileLocationRepository } from './discovery-visible-profile-location.repository';

describe('DiscoveryVisibleProfileLocationRepository', () => {
  const readMock = {
    getDocumentsLiveSafe: vi.fn(),
  };

  let repository: DiscoveryVisibleProfileLocationRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    readMock.getDocumentsLiveSafe.mockReturnValue(of([]));
    repository = new DiscoveryVisibleProfileLocationRepository(readMock as any);
  });

  it('não abre listener quando não há perfis visíveis', async () => {
    const result = await firstValueFrom(repository.watchByUids$([]));

    expect(result).toEqual([]);
    expect(readMock.getDocumentsLiveSafe).not.toHaveBeenCalled();
  });

  it('observa perfis visíveis em lotes e preserva ausência de localização', async () => {
    const uids = Array.from({ length: 11 }, (_, index) => `u${index + 1}`);

    readMock.getDocumentsLiveSafe
      .mockReturnValueOnce(
        of([
          {
            uid: 'u1',
            latitude: -22.93,
            longitude: -43.35,
            geohash: '75cm',
          },
          {
            uid: 'u2',
          },
        ])
      )
      .mockReturnValueOnce(
        of([
          {
            uid: 'u11',
            latitude: -22.91,
            longitude: -43.31,
            geohash: '75cq',
          },
        ])
      );

    const result = await firstValueFrom(repository.watchByUids$(uids));

    expect(readMock.getDocumentsLiveSafe).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uid: 'u1',
          latitude: -22.93,
          longitude: -43.35,
        }),
        expect.objectContaining({
          uid: 'u2',
          latitude: null,
          longitude: null,
          geohash: null,
        }),
        expect.objectContaining({
          uid: 'u11',
          latitude: -22.91,
          longitude: -43.31,
        }),
      ])
    );
  });
});
