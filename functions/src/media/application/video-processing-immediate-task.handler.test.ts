import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  normalizeImmediateVideoProcessingTaskData,
} from './video-processing-immediate-task.handler';

describe('video-processing-immediate-task.handler', () => {
  it('normaliza a identidade do job solicitado', () => {
    assert.deepEqual(
      normalizeImmediateVideoProcessingTaskData({
        ownerUid: ' owner-1 ',
        videoId: ' video-1 ',
      }),
      {
        ownerUid: 'owner-1',
        videoId: 'video-1',
      }
    );
  });

  it('rejeita caminhos e identificadores vazios', () => {
    assert.equal(
      normalizeImmediateVideoProcessingTaskData({
        ownerUid: 'owner/1',
        videoId: 'video-1',
      }),
      null
    );
    assert.equal(
      normalizeImmediateVideoProcessingTaskData({
        ownerUid: 'owner-1',
        videoId: '',
      }),
      null
    );
  });
});
