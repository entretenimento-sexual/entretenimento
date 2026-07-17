import { describe, expect, it } from 'vitest';

import { MediaViewRecordingRegistry } from './media-view-recording-registry';

describe('MediaViewRecordingRegistry', () => {
  it('impede duplicidade enquanto a visualização está em andamento', () => {
    const registry = new MediaViewRecordingRegistry();

    expect(registry.tryStart('owner:media')).toBe(true);
    expect(registry.tryStart('owner:media')).toBe(false);
    expect(registry.isPending('owner:media')).toBe(true);
    expect(registry.isRecorded('owner:media')).toBe(false);
  });

  it('confirma a chave somente após sucesso', () => {
    const registry = new MediaViewRecordingRegistry();

    registry.tryStart('owner:media');
    registry.confirm('owner:media');

    expect(registry.isPending('owner:media')).toBe(false);
    expect(registry.isRecorded('owner:media')).toBe(true);
    expect(registry.tryStart('owner:media')).toBe(false);
  });

  it('libera nova tentativa após falha', () => {
    const registry = new MediaViewRecordingRegistry();

    registry.tryStart('owner:media');
    registry.release('owner:media');

    expect(registry.isPending('owner:media')).toBe(false);
    expect(registry.isRecorded('owner:media')).toBe(false);
    expect(registry.tryStart('owner:media')).toBe(true);
  });
});
