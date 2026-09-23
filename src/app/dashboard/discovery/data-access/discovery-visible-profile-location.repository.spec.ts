import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoveryVisibleProfileLocationRepository } from './discovery-visible-profile-location.repository';

describe('DiscoveryVisibleProfileLocationRepository', () => {
  const readMock = {
    getDocumentLiveSafe: vi.fn(),
  };

  let repository: DiscoveryVisibleProfileLocationRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    readMock.getDocumentLiveSafe.mockReturnValue(of(null));
    repository = new DiscoveryVisibleProfileLocationRepository(readMock as any);
  });

  it('não abre listener quando não há perfis visíveis', async () => {
    const result = await firstValueFrom(repository.watchByUids$([]));

    expect(result).toEqual([]);
    expect(readMock.getDocumentLiveSafe).not.toHaveBeenCalled();
  });

  it('observa somente UIDs visíveis por get temporal e preserva ausência de localização', async () => {
    const validUntil = Date.now() + 60_000;

    readMock.getDocumentLiveSafe
      .mockReturnValueOnce(
        of({
          uid: 'u1',
          ageEligibilityVerifiedAdult: true,
          ageEligibilityValidUntil: validUntil,
          latitude: -22.93,
          longitude: -43.35,
          geohash: '75cm',
        })
      )
      .mockReturnValueOnce(
        of({
          uid: 'u2',
          ageEligibilityVerifiedAdult: true,
          ageEligibilityValidUntil: validUntil,
        })
      )
      .mockReturnValueOnce(
        of({
          uid: 'u3',
          ageEligibilityVerifiedAdult: true,
          ageEligibilityValidUntil: Date.now() - 1,
          latitude: -22.91,
          longitude: -43.31,
          geohash: '75cq',
        })
      );

    const result = await firstValueFrom(
      repository.watchByUids$(['u3', 'u1', 'u2'])
    );

    expect(readMock.getDocumentLiveSafe).toHaveBeenCalledTimes(3);
    expect(readMock.getDocumentLiveSafe).toHaveBeenCalledWith(
      'public_profiles',
      'u1',
      { idField: 'uid', requireAuth: true }
    );
    expect(result).toEqual([
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
    ]);
  });
});
