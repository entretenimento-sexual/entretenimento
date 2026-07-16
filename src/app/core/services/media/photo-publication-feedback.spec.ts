import { describe, expect, it } from 'vitest';

import { getPhotoPublicationFeedback } from './photo-publication-feedback';

describe('getPhotoPublicationFeedback', () => {
  it('confirma publicação quando o backend aprova a foto', () => {
    expect(
      getPhotoPublicationFeedback({
        photoId: 'photo-1',
        moderationStatus: 'APPROVED',
      })
    ).toEqual({
      kind: 'success',
      message: 'Foto publicada com sucesso.',
    });
  });

  it('informa análise sem comunicar publicação imediata', () => {
    expect(
      getPhotoPublicationFeedback({
        photoId: 'photo-2',
        moderationStatus: 'PENDING_REVIEW',
      })
    ).toEqual({
      kind: 'warning',
      message: 'Foto enviada para análise. Ela será exibida após a aprovação.',
    });
  });
});
