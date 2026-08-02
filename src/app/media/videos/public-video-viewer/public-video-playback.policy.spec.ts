import { describe, expect, it } from 'vitest';

import { classifyPublicVideoPlaybackFailure } from './public-video-playback.policy';

describe('public video playback policy', () => {
  it('prioriza estado offline independentemente do MediaError', () => {
    const failure = classifyPublicVideoPlaybackFailure(2, false);

    expect(failure.kind).toBe('offline');
    expect(failure.shouldRefreshAccess).toBe(false);
    expect(failure.retryWhenOnline).toBe(true);
  });

  it('ignora MEDIA_ERR_ABORTED para não renovar durante navegação', () => {
    const failure = classifyPublicVideoPlaybackFailure(1, true);

    expect(failure.kind).toBe('aborted');
    expect(failure.ignored).toBe(true);
    expect(failure.shouldRefreshAccess).toBe(false);
  });

  it('renova acesso uma vez em falha de rede', () => {
    const failure = classifyPublicVideoPlaybackFailure(2, true);

    expect(failure.kind).toBe('network');
    expect(failure.shouldRefreshAccess).toBe(true);
  });

  it('não mascara erro de decodificação como expiração de URL', () => {
    const failure = classifyPublicVideoPlaybackFailure(3, true);

    expect(failure.kind).toBe('decode');
    expect(failure.shouldRefreshAccess).toBe(false);
    expect(failure.message).toContain('decodificado');
  });

  it('permite uma tentativa de atualização para fonte indisponível', () => {
    const failure = classifyPublicVideoPlaybackFailure(4, true);

    expect(failure.kind).toBe('source');
    expect(failure.shouldRefreshAccess).toBe(true);
  });

  it('trata código desconhecido como falha recuperável de acesso', () => {
    const failure = classifyPublicVideoPlaybackFailure(99, true);

    expect(failure.kind).toBe('unknown');
    expect(failure.shouldRefreshAccess).toBe(true);
  });
});
