import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { forceVideoAutoPublicationData } from './video-auto-publication.policy';

describe('video-auto-publication.policy', () => {
  it('ativa publicação automática quando a propriedade não foi enviada', () => {
    assert.deepEqual(forceVideoAutoPublicationData({ videoId: 'video-1' }), {
      videoId: 'video-1',
      publishWhenReady: true,
    });
  });

  it('sobrescreve clientes antigos que tentam salvar sem publicar', () => {
    assert.deepEqual(
      forceVideoAutoPublicationData({
        videoId: 'video-2',
        publishWhenReady: false,
      }),
      {
        videoId: 'video-2',
        publishWhenReady: true,
      }
    );
  });

  it('preserva os demais campos do registro', () => {
    const payload = forceVideoAutoPublicationData({
      ownerUid: 'owner-1',
      videoId: 'video-3',
      title: 'Apresentação',
      reactionsEnabled: false,
    });

    assert.equal(payload.ownerUid, 'owner-1');
    assert.equal(payload.videoId, 'video-3');
    assert.equal(payload.title, 'Apresentação');
    assert.equal(payload.reactionsEnabled, false);
    assert.equal(payload.publishWhenReady, true);
  });
});
