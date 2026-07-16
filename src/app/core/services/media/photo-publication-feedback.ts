import type { IPublishPhotoResult } from './media-publication.service';

export type PhotoPublicationFeedback = Readonly<{
  kind: 'success' | 'warning';
  message: string;
}>;

export function getPhotoPublicationFeedback(
  result: IPublishPhotoResult
): PhotoPublicationFeedback {
  if (result.moderationStatus === 'PENDING_REVIEW') {
    return {
      kind: 'warning',
      message: 'Foto enviada para análise. Ela será exibida após a aprovação.',
    };
  }

  return {
    kind: 'success',
    message: 'Foto publicada com sucesso.',
  };
}
