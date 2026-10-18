import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const root = resolve(process.cwd(), 'src/app');
function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}
describe('Video errors: state and presentation boundaries', () => {
  it('never turns metadata query failure into an empty library', () => {
    const file = source('core/services/media/video-library.service.ts');
    const segment = file.slice(file.indexOf('watchOwnedVideoMetadata$('),
      file.indexOf('watchPrivateVideos$('));
    expect(segment).not.toMatch(/catchError\s*\([\s\S]*?return of\(\[\]\)/);
    expect(segment).toContain('shareReplay');
  });
  it('uses existing NgRx error state and manual retry', () => {
    const effects = source('media/videos/state/profile-video-library.effects.ts');
    const facade = source('media/videos/state/profile-video-library.facade.ts');
    const template = source('media/videos/profile-videos/profile-videos.component.html');
    expect(effects).toContain('ProfileVideoLibraryActions.watchFailed');
    expect(effects).toContain('reportSilently(');
    expect(facade).toContain('retry(): void');
    expect(template).toContain("libraryStatus === 'error'");
    expect(template).toContain('retryVideoLibrary()');
  });
  it('distinguishes comment query errors from empty comments', () => {
    const file = source('core/services/media/media-video-comments.service.ts');
    const segment = file.slice(file.indexOf('watchVisibleComments$('),
      file.indexOf('createComment$('));
    expect(segment).not.toMatch(/catchError\s*\([\s\S]*?return of\(\[\]\)/);
    const component = source('media/videos/public-video-viewer/public-video-viewer.component.ts');
    const template = source('media/videos/public-video-viewer/public-video-viewer.component.html');
    expect(component).toContain("status: 'error' as const");
    expect(component).toContain("'video_comments_load_failed'");
    expect(template).toContain("commentState?.status === 'error'");
    expect(template).toContain('retryComments()');
  });
  it('shares the single platform connectivity policy', () => {
    const viewer = source('media/videos/public-video-viewer/public-video-viewer.component.ts');
    expect(viewer).toContain('OFFLINE_USER_MESSAGE');
    expect(viewer).toContain('this.networkStatus.isOnlineSnapshot()');
    expect(viewer).not.toContain('navigator.onLine');
  });
  it('bounds admin status refresh to a shared visibility-aware trigger', () => {
    const panel = source('admin-dashboard/video-moderation/video-moderation.component.ts');
    expect(panel).toContain('5 * 60 * 1000');
    expect(panel).toContain("fromEvent(this.document, 'visibilitychange')");
    expect(panel).toContain('filter(() => !this.document.hidden)');
    expect(panel).toContain('this.visibleRefresh$.pipe(');
    expect(panel).not.toContain('const PROCESSING_STATUS_REFRESH_INTERVAL_MS = 60 * 1000');
  });
  it('triages provider, scheduler, jobs and evidence without authorizing mutations', () => {
    const panel = source('admin-dashboard/video-moderation/video-moderation.component.html');
    const policy = source('admin-dashboard/video-moderation/video-processing-triage.policy.ts');
    expect(panel).toContain('assessVideoProcessingOperations(diagnostic)');
    expect(policy).toContain("scheduler.executionHealth === 'FAILED'");
    expect(policy).toContain("scheduler.jobsHealth === 'ATTENTION'");
    expect(policy).toContain("scheduler.evidenceConfidence !== 'RECENT'");
    expect(policy).not.toMatch(/httpsCallable|\.collection\(|\.delete\(/);
  });
  it('uses canonical admin diagnostics instead of video upload or library reasons', () => {
    const status = source('core/services/moderation/admin-video-moderation.service.ts');
    const cleanup = source('core/services/moderation/admin-video-terminal-temporary-cleanup.service.ts');
    const backend = readFileSync(resolve(process.cwd(),
      'functions/src/media/application/admin-video-processing-status.handler.ts'), 'utf8');
    expect(status).toContain("'video_operational_diagnostic_load_failed'");
    expect(cleanup).toContain("'video_terminal_cleanup_queue_load_failed'");
    expect(cleanup).toContain("reasonHint: 'video_terminal_cleanup_action_failed'");
    expect(cleanup).not.toContain("'video_library_load_failed'");
    expect(cleanup).not.toContain("reasonHint: 'video_upload_failed'");
    expect(backend).toContain('VIDEO_MEDIA_ADMIN_DIAGNOSTIC_UNAVAILABLE');
    expect(backend).not.toContain('error.message');
  });
  it('distinguishes operational recovery from user uploads', () => {
    const admin = source('core/services/moderation/admin-video-processing-recovery.service.ts');
    expect(admin).toContain("reasonHint: 'video_recovery_action_failed'");
    expect(admin).toContain("'video_recovery_queue_load_failed'");
    expect(admin).not.toContain("reasonHint: 'video_upload_failed'");
  });
});
