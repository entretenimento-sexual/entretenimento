import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveMediaPublicationVisibility,
  resolvePhotoCommentsPolicy,
} from './media-publication-audience.policy';

describe('media publication audience contract', () => {
  it('mantém somente PUBLIC e FRIENDS disponíveis para publicação', () => {
    assert.deepEqual(resolveMediaPublicationVisibility('PUBLIC'), {
      status: 'AVAILABLE',
      value: 'PUBLIC',
    });
    assert.deepEqual(resolveMediaPublicationVisibility('FRIENDS'), {
      status: 'AVAILABLE',
      value: 'FRIENDS',
    });
  });

  it('reserva SUBSCRIBERS e PREMIUM até entitlement de audiência completo', () => {
    assert.deepEqual(resolveMediaPublicationVisibility('SUBSCRIBERS'), {
      status: 'UNAVAILABLE_ENTITLEMENT',
      requested: 'SUBSCRIBERS',
    });
    assert.deepEqual(resolveMediaPublicationVisibility('PREMIUM'), {
      status: 'UNAVAILABLE_ENTITLEMENT',
      requested: 'PREMIUM',
    });
  });

  it('não converte audiência desconhecida silenciosamente em PUBLIC', () => {
    assert.deepEqual(resolveMediaPublicationVisibility('unexpected'), {
      status: 'INVALID',
    });
  });

  it('reserva comentários SUBSCRIBERS e preserva OFF/FRIENDS/EVERYONE', () => {
    assert.deepEqual(resolvePhotoCommentsPolicy('SUBSCRIBERS', true), {
      status: 'UNAVAILABLE_ENTITLEMENT',
      requested: 'SUBSCRIBERS',
    });
    assert.deepEqual(resolvePhotoCommentsPolicy('FRIENDS', true), {
      status: 'AVAILABLE',
      value: 'FRIENDS',
    });
    assert.deepEqual(resolvePhotoCommentsPolicy('EVERYONE', false), {
      status: 'AVAILABLE',
      value: 'OFF',
    });
  });
});
