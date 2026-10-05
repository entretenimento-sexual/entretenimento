import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const PROTECTED_CALLABLES = [
  'reserve-photo-upload.handler.ts',
  'reserve-video-upload.handler.ts',
  'register-private-photo-upload.handler.ts',
  'register-private-video-upload-orchestrator.handler.ts',
  'publish-photo-orchestrator.handler.ts',
  'publish-video-orchestrator.handler.ts',
  'delete-profile-photo.handler.ts',
  'delete-profile-video.handler.ts',
  'get-private-video-access-urls.handler.ts',
  'get-authorized-photo-owner-page.handler.ts',
  'get-public-media-discovery.handler.ts',
  'get-public-photo-access-urls.handler.ts',
  'get-public-video-access-urls.handler.ts',
  'start-public-video-playback-session.handler.ts',
  'record-photo-view-orchestrator.handler.ts',
  'record-video-view-orchestrator.handler.ts',
  'record-video-retention-orchestrator.handler.ts',
  'toggle-photo-reaction.handler.ts',
  'toggle-video-reaction.handler.ts',
  'rate-video.handler.ts',
  'create-photo-comment-orchestrator.handler.ts',
  'create-video-comment-orchestrator.handler.ts',
  'report-photo-content.handler.ts',
  'report-video-content.handler.ts',
] as const;

const RATE_LIMITED_CALLABLES = new Set([
  'reserve-photo-upload.handler.ts',
  'reserve-video-upload.handler.ts',
  'register-private-photo-upload.handler.ts',
  'register-private-video-upload-orchestrator.handler.ts',
  'publish-photo-orchestrator.handler.ts',
  'publish-video-orchestrator.handler.ts',
  'delete-profile-photo.handler.ts',
  'delete-profile-video.handler.ts',
  'get-private-video-access-urls.handler.ts',
  'get-authorized-photo-owner-page.handler.ts',
  'get-public-media-discovery.handler.ts',
  'start-public-video-playback-session.handler.ts',
  'record-photo-view-orchestrator.handler.ts',
  'record-video-view-orchestrator.handler.ts',
  'record-video-retention-orchestrator.handler.ts',
  'toggle-photo-reaction.handler.ts',
  'toggle-video-reaction.handler.ts',
  'rate-video.handler.ts',
  'create-photo-comment-orchestrator.handler.ts',
  'create-video-comment-orchestrator.handler.ts',
  'report-photo-content.handler.ts',
  'report-video-content.handler.ts',
]);

function source(name: string): string {
  return readFileSync(
    resolve(process.cwd(), 'src', 'media', 'application', name),
    'utf8'
  );
}

describe('Media callable security contract', () => {
  for (const name of PROTECTED_CALLABLES) {
    it(`${name} exige App Check no callable real`, () => {
      const content = source(name);
      assert.match(content, /enforceAppCheck:\s*REQUIRE_[A-Z_]*APP_CHECK/);
      assert.match(content, /assert[A-Za-z]*AppCheck\(request\.app\)/);
    });
  }

  for (const name of RATE_LIMITED_CALLABLES) {
    it(`${name} consome quota backend antes da operação de produto`, () => {
      const content = source(name);
      assert.match(
        content,
        /consume(?:BackendRateLimitQuota|Public[A-Za-z]+Quota)\(/
      );
    });
  }
});
