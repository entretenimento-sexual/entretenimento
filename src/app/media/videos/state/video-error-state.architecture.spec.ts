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
  it('distinguishes operational recovery from user uploads', () => {
    const admin = source('core/services/moderation/admin-video-processing-recovery.service.ts');
    expect(admin).toContain("reasonHint: 'video_recovery_action_failed'");
    expect(admin).toContain("'video_recovery_queue_load_failed'");
    expect(admin).not.toContain("reasonHint: 'video_upload_failed'");
  });
});
