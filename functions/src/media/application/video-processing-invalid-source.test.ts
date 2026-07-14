import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasPersistedInvalidProcessingSourceFailure,
} from './video-processing-invalid-source';

describe('hasPersistedInvalidProcessingSourceFailure', () => {
  it('reconhece o erro inválido já persistido', () => {
    assert.equal(
      hasPersistedInvalidProcessingSourceFailure({
        status: 'failed',
        processingStage: 'failed',
        processingErrorCode: 'INVALID_PROCESSING_SOURCE',
      }),
      true
    );
  });

  it('não bloqueia estados que ainda precisam ser avaliados', () => {
    assert.equal(
      hasPersistedInvalidProcessingSourceFailure({
        status: 'ready',
        processingStage: 'ready',
      }),
      false
    );
    assert.equal(
      hasPersistedInvalidProcessingSourceFailure({
        status: 'failed',
        processingStage: 'failed',
        processingErrorCode: 'PROVIDER_ERROR',
      }),
      false
    );
  });
});
