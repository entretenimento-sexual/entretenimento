import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MediaQueryService } from './media-query.service';

describe('MediaQueryService', () => {
  it('mantém createdAt desconhecido em zero e converte displayDate Timestamp', async () => {
    const errorNotifier = {
      showError: vi.fn(),
    } as any;
    const photoFirestoreService = {
      getPhotosByUser: vi.fn(() =>
        of([
          {
            id: 'photo-1',
            url: 'blob:photo-1',
            fileName: 'photo-1.jpg',
            createdAt: { unexpected: true },
            displayDate: {
              toMillis: () => 1_721_234_567_890,
            },
            path: 'users/owner-1/photos/photo-1.jpg',
          },
        ])
      ),
    } as any;
    const service = new MediaQueryService(
      errorNotifier,
      photoFirestoreService
    );

    const result = await firstValueFrom(
      service.watchProfilePhotos$('owner-1')
    );

    expect(result).toHaveLength(1);
    expect(result[0].createdAt).toBe(0);
    expect(result[0].displayDate).toBe(1_721_234_567_890);
    expect(errorNotifier.showError).not.toHaveBeenCalled();
  });

  it('não consulta a biblioteca quando o UID é inválido', async () => {
    const errorNotifier = {
      showError: vi.fn(),
    } as any;
    const photoFirestoreService = {
      getPhotosByUser: vi.fn(),
    } as any;
    const service = new MediaQueryService(
      errorNotifier,
      photoFirestoreService
    );

    const result = await firstValueFrom(service.watchProfilePhotos$('   '));

    expect(result).toEqual([]);
    expect(photoFirestoreService.getPhotosByUser).not.toHaveBeenCalled();
  });
});
