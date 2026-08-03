import { describe, expect, it } from 'vitest';

import { IVideoItem } from 'src/app/core/interfaces/media/i-video-item';
import { IVideoPublicationConfig } from 'src/app/core/interfaces/media/i-video-publication-config';
import { resolveVideoLifecyclePresentation } from './video-lifecycle-state.policy';

const baseVideo: IVideoItem = {
  id: 'video-1',
  ownerUid: 'owner-1',
  url: 'users/owner-1/uploads/videos/video-1.mp4',
  status: 'uploaded',
  createdAt: 1,
};

const basePublication: IVideoPublicationConfig = {
  id: 'video-1',
  videoId: 'video-1',
  ownerUid: 'owner-1',
  isPublished: false,
  publishWhenReady: true,
  visibility: 'PRIVATE',
  orderIndex: 0,
  moderationStatus: 'PRIVATE',
};

describe('video-lifecycle-state.policy', () => {
  it.each([
    ['uploaded', 'REGISTERED', 'Registrado'],
    ['queued', 'QUEUED', 'Na fila'],
    ['processing', 'PROCESSING', 'Processando'],
  ] as const)(
    'deriva o status persistido %s como %s',
    (status, expectedState, expectedLabel) => {
      const result = resolveVideoLifecyclePresentation(
        { ...baseVideo, status },
        basePublication
      );

      expect(result.state).toBe(expectedState);
      expect(result.label).toBe(expectedLabel);
      expect(result.tone).toBe('progress');
      expect(result.terminal).toBe(false);
    }
  );

  it('representa publicação em andamento quando o derivado está pronto', () => {
    const result = resolveVideoLifecyclePresentation(
      { ...baseVideo, status: 'ready' },
      basePublication
    );

    expect(result).toMatchObject({
      state: 'PUBLISHING',
      label: 'Publicando',
      tone: 'progress',
      terminal: false,
    });
  });

  it('prioriza moderação pendente sobre o status técnico pronto', () => {
    const result = resolveVideoLifecyclePresentation(
      { ...baseVideo, status: 'ready' },
      {
        ...basePublication,
        isPublished: true,
        moderationStatus: 'PENDING_REVIEW',
      }
    );

    expect(result).toMatchObject({
      state: 'PENDING_REVIEW',
      label: 'Em análise',
      tone: 'warning',
    });
  });

  it('representa publicação aprovada como estado terminal', () => {
    const result = resolveVideoLifecyclePresentation(
      { ...baseVideo, status: 'ready' },
      {
        ...basePublication,
        isPublished: true,
        publishWhenReady: false,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
      }
    );

    expect(result).toMatchObject({
      state: 'PUBLISHED',
      label: 'Publicado',
      tone: 'success',
      terminal: true,
    });
  });

  it('preserva mensagem técnica sanitizada em falha de processamento', () => {
    const result = resolveVideoLifecyclePresentation(
      {
        ...baseVideo,
        status: 'failed',
        processingErrorMessage: '  Codec incompatível.  ',
      },
      basePublication
    );

    expect(result).toMatchObject({
      state: 'FAILED',
      label: 'Falha',
      message: 'Codec incompatível.',
      tone: 'error',
      terminal: true,
    });
  });

  it('preserva o motivo de rejeição informado pela moderação', () => {
    const result = resolveVideoLifecyclePresentation(
      { ...baseVideo, status: 'ready' },
      {
        ...basePublication,
        moderationStatus: 'REJECTED',
        moderationReason: 'Conteúdo fora das regras.',
      }
    );

    expect(result).toMatchObject({
      state: 'REJECTED',
      label: 'Rejeitado',
      message: 'Conteúdo fora das regras.',
      tone: 'error',
      terminal: true,
    });
  });

  it.each([
    ['FLAGGED', 'Sinalizado'],
    ['HIDDEN', 'Oculto'],
  ] as const)('representa moderação %s como bloqueio', (moderationStatus, label) => {
    const result = resolveVideoLifecyclePresentation(
      { ...baseVideo, status: 'ready' },
      {
        ...basePublication,
        isPublished: true,
        moderationStatus,
      }
    );

    expect(result).toMatchObject({
      state: 'BLOCKED',
      label,
      tone: 'error',
      terminal: false,
    });
  });

  it('identifica vídeo privado criado pelo fluxo legado', () => {
    const result = resolveVideoLifecyclePresentation(
      { ...baseVideo, status: 'ready' },
      {
        ...basePublication,
        publishWhenReady: false,
        isPublished: false,
      }
    );

    expect(result).toMatchObject({
      state: 'LEGACY_PRIVATE',
      label: 'Vídeo antigo',
      tone: 'warning',
      terminal: false,
    });
  });
});
