import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hashMediaMutationRequest,
  resolveUploadMutationCost,
} from './media-mutation-idempotency.policy';

describe('media-mutation-idempotency.policy', () => {
  it('gera o mesmo fingerprint independentemente da ordem das chaves', () => {
    const first = hashMediaMutationRequest({
      ownerUid: 'owner',
      videoId: 'video',
      settings: { title: 'Título', commentsEnabled: true },
    });
    const second = hashMediaMutationRequest({
      settings: { commentsEnabled: true, title: 'Título' },
      videoId: 'video',
      ownerUid: 'owner',
    });

    assert.equal(first, second);
  });

  it('diferencia operações com conteúdo efetivamente distinto', () => {
    assert.notEqual(
      hashMediaMutationRequest({ videoId: 'one' }),
      hashMediaMutationRequest({ videoId: 'two' })
    );
  });

  it('calcula custo de upload por blocos e respeita teto', () => {
    const unit = 10 * 1024 * 1024;

    assert.equal(resolveUploadMutationCost(1), 1);
    assert.equal(resolveUploadMutationCost(unit), 1);
    assert.equal(resolveUploadMutationCost(unit + 1), 2);
    assert.equal(resolveUploadMutationCost(500 * 1024 * 1024), 50);
    assert.equal(resolveUploadMutationCost(900 * 1024 * 1024), 50);
  });

  it('aplica custo conservador quando o tamanho não pode ser validado', () => {
    assert.equal(resolveUploadMutationCost(null), 5);
    assert.equal(resolveUploadMutationCost('inválido'), 5);
  });
});
