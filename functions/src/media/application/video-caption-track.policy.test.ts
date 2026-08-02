import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertValidWebVttContent,
  normalizeVideoCaptionMetadata,
} from './video-caption-track.policy';

describe('video caption track policy', () => {
  it('normaliza idioma, rótulo e faixa padrão', () => {
    assert.deepEqual(normalizeVideoCaptionMetadata({
      captionLanguage: 'pt-br',
      captionLabel: '  Português   (Brasil)  ',
    }), {
      id: 'captions-1',
      kind: 'captions',
      language: 'pt-BR',
      label: 'Português (Brasil)',
      isDefault: true,
    });
  });

  it('aceita WebVTT com cue temporal', () => {
    assert.doesNotThrow(() => assertValidWebVttContent(
      'WEBVTT\n\n00:00.000 --> 00:02.500\nOlá.\n'
    ));
  });

  it('rejeita arquivo renomeado sem cabeçalho WebVTT', () => {
    assert.throws(() => assertValidWebVttContent(
      '00:00.000 --> 00:02.500\nOlá.\n'
    ));
  });

  it('rejeita WebVTT sem qualquer cue temporal', () => {
    assert.throws(() => assertValidWebVttContent('WEBVTT\n\nNOTE vazio\n'));
  });

  it('rejeita idioma e rótulo inválidos', () => {
    assert.throws(() => normalizeVideoCaptionMetadata({
      captionLanguage: '../pt',
      captionLabel: 'Português',
    }));
    assert.throws(() => normalizeVideoCaptionMetadata({
      captionLanguage: 'pt-BR',
      captionLabel: '   ',
    }));
  });
});
