import { describe, expect, it } from 'vitest';
import { ProfileVideoLibraryActions } from './profile-video-library.actions';
import { profileVideoLibraryFeature } from './profile-video-library.reducer';

describe('Profile video library status', () => {
  const reducer = profileVideoLibraryFeature.reducer;
  const initial = reducer(undefined, { type: '@@init' });

  it('distinguishes an empty result from a query failure', () => {
    const loading = reducer(initial,
      ProfileVideoLibraryActions.watchRequested({ ownerUid: 'owner-a' }));
    expect(loading.status).toBe('loading');
    const empty = reducer(loading,
      ProfileVideoLibraryActions.snapshotReceived({
        ownerUid: 'owner-a', items: [],
      }));
    expect(empty.status).toBe('ready');
    expect(empty.errorMessage).toBeNull();
    const failed = reducer(loading,
      ProfileVideoLibraryActions.watchFailed({
        ownerUid: 'owner-a', message: 'Sem conexão',
      }));
    expect(failed.status).toBe('error');
    expect(failed.errorMessage).toBe('Sem conexão');
    const retried = reducer(failed,
      ProfileVideoLibraryActions.watchRequested({ ownerUid: 'owner-a' }));
    expect(retried.status).toBe('loading');
    expect(retried.errorMessage).toBeNull();
  });

  it('ignores stale errors and resets state on stop', () => {
    const active = reducer(initial,
      ProfileVideoLibraryActions.watchRequested({ ownerUid: 'owner-b' }));
    const stale = reducer(active,
      ProfileVideoLibraryActions.watchFailed({
        ownerUid: 'owner-a', message: 'outdated',
      }));
    expect(stale).toBe(active);
    const stopped = reducer(active, ProfileVideoLibraryActions.watchStopped());
    expect(stopped.ownerUid).toBeNull();
    expect(stopped.errorMessage).toBeNull();
  });
});
