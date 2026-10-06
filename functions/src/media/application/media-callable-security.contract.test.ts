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
  'get-recent-public-media-views.handler.ts',
  'manage-photo-publication.handler.ts',
  'update-video-publication-settings.handler.ts',
  'normalize-legacy-photo-moderation.handler.ts',
  'normalize-legacy-video-moderation.handler.ts',
  'submit-media-moderation-contest.handler.ts',
  'moderate-photo-comment-orchestrator.handler.ts',
  'manage-video-comment.handler.ts',
  'admin-video-processing-recovery.handler.ts',
  'admin-video-processing-status.handler.ts',
  'review-photo-content-report.handler.ts',
  'review-video-content-report.handler.ts',
  'review-media-moderation-contest.handler.ts',
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
  'get-public-photo-access-urls.handler.ts',
  'get-public-video-access-urls.handler.ts',
  'get-recent-public-media-views.handler.ts',
  'manage-photo-publication.handler.ts',
  'update-video-publication-settings.handler.ts',
  'normalize-legacy-photo-moderation.handler.ts',
  'normalize-legacy-video-moderation.handler.ts',
  'submit-media-moderation-contest.handler.ts',
  'moderate-photo-comment-orchestrator.handler.ts',
  'manage-video-comment.handler.ts',
  'admin-video-processing-recovery.handler.ts',
  'admin-video-processing-status.handler.ts',
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
  'review-photo-content-report.handler.ts',
  'review-video-content-report.handler.ts',
  'review-media-moderation-contest.handler.ts',
]);

function source(name: string): string {
  return readFileSync(
    resolve(process.cwd(), 'src', 'media', 'application', name),
    'utf8'
  );
}

// Tombstones legados de despublicação de foto/vídeo ficam fora da matriz:
// são APIs deliberadamente fail-closed e instrumentadas até a retirada.
// Triggers, schedules e cores internos também não são callables externos do cliente.
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


describe('Media internal callable cores stay behind protected orchestrators', () => {
  const mediaIndex = readFileSync(
    resolve(process.cwd(), 'src', 'media', 'index.ts'),
    'utf8'
  );

  it('não exporta diretamente os cores internos de comentário e publicação', () => {
    assert.doesNotMatch(
      mediaIndex,
      /from '\.\/application\/manage-photo-comment\.handler'/
    );
    assert.doesNotMatch(
      mediaIndex,
      /export\s*\{[^}]*\bpublishVideo\b[^}]*\}\s*from '\.\/application\/manage-video-publication\.handler'/
    );
    assert.doesNotMatch(
      mediaIndex,
      /export\s*\{[^}]*\bcreateVideoComment\b[^}]*\}\s*from '\.\/application\/manage-video-comment\.handler'/
    );
  });

  it('expõe somente os wrappers protegidos equivalentes', () => {
    assert.match(
      mediaIndex,
      /createPhotoComment[\s\S]*create-photo-comment-orchestrator\.handler/
    );
    assert.match(
      mediaIndex,
      /moderatePhotoComment[\s\S]*moderate-photo-comment-orchestrator\.handler/
    );
    assert.match(
      mediaIndex,
      /createVideoComment[\s\S]*create-video-comment-orchestrator\.handler/
    );
    assert.match(
      mediaIndex,
      /publishVideo[\s\S]*publish-video-orchestrator\.handler/
    );
  });
});
