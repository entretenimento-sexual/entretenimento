import type { User } from 'firebase/auth';
import { BehaviorSubject, Observable, Subject, defer, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SharedFriendsWatch } from './shared-friends-watch';

function setup() {
  const user = (uid: string) => ({ uid } as User);
  const authUser$ = new BehaviorSubject<User | null>(user('a'));
  const uid$ = new BehaviorSubject<string | null>('a');
  const session = {
    currentAuthUser: authUser$.value,
    authUser$, uid$, terminationVersionSnapshot: 0, isTerminatingSnapshot: false,
  };
  const watch = new SharedFriendsWatch(session);
  const snapshots = new Subject<string>();
  const cleanup = vi.fn();
  const load = vi.fn(() => new Observable<string>(sink => {
    const sub = snapshots.subscribe(sink);
    return () => { sub.unsubscribe(); cleanup(); };
  }));
  const jobs: Subject<string>[] = [];
  const hydrate = vi.fn((_: string) => {
    const result = new Subject<string>();
    jobs.push(result);
    return result;
  });
  const observe = (pageSize = 24, uid = 'a') => watch.watch$(uid, pageSize, load, hydrate);
  return { user, session, authUser$, uid$, watch, snapshots, cleanup, load, jobs, hydrate, observe };
}

describe('SharedFriendsWatch', () => {
  it('shares one live query and simultaneous hydration, releases last consumer', () => {
    const { observe, load, snapshots, hydrate, jobs, cleanup } = setup();
    const a = vi.fn(), b = vi.fn();
    const first = observe().subscribe(a);
    const second = observe().subscribe(b);
    snapshots.next('snapshot');
    expect(load).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenCalledTimes(1);
    jobs[0].next('fresh'); jobs[0].complete();
    expect(a).toHaveBeenCalledWith('fresh');
    expect(b).toHaveBeenCalledWith('fresh');
    first.unsubscribe();
    expect(cleanup).not.toHaveBeenCalled();
    second.unsubscribe();
    expect(cleanup).toHaveBeenCalledOnce();
    const third = observe().subscribe();
    expect(load).toHaveBeenCalledTimes(2);
    third.unsubscribe();
  });

  it('never replays completed hydrated profiles to a new consumer', () => {
    const { observe, snapshots, jobs, hydrate, load } = setup();
    const first = observe().subscribe();
    snapshots.next('snapshot');
    jobs[0].next('old'); jobs[0].complete();
    const next = vi.fn();
    const second = observe().subscribe(next);
    expect(next).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledOnce();
    expect(hydrate).toHaveBeenCalledTimes(2);
    jobs[1].next('fresh'); jobs[1].complete();
    expect(next).toHaveBeenCalledExactlyOnceWith('fresh');
    first.unsubscribe(); second.unsubscribe();
  });

  it('cancels old hydration on a new snapshot', () => {
    const { observe, snapshots, jobs } = setup();
    const seen = vi.fn();
    const sub = observe().subscribe(seen);
    snapshots.next('old');
    snapshots.next('new');
    jobs[0].next('obsolete');
    expect(seen).not.toHaveBeenCalled();
    jobs[1].next('current');
    expect(seen).toHaveBeenCalledExactlyOnceWith('current');
    sub.unsubscribe();
  });

  it('isolates page sizes and rejects a different owner before loading', () => {
    const { observe, load } = setup();
    const first = observe(24).subscribe();
    const second = observe(48).subscribe();
    const error = vi.fn();
    observe(24, 'b').subscribe({ error });
    expect(error).toHaveBeenCalledWith(expect.objectContaining({code:'friends/session-revoked'}));
    expect(load).toHaveBeenCalledTimes(2);
    first.unsubscribe(); second.unsubscribe();
  });

  it('revokes same UID replacement and prevents late hydration delivery', () => {
    const { observe, snapshots, jobs, session, authUser$, user, cleanup, load } = setup();
    const seen = vi.fn(), error = vi.fn();
    const old = observe().subscribe({ next: seen, error });
    snapshots.next('old');
    session.currentAuthUser = user('a');
    authUser$.next(session.currentAuthUser);
    expect(old.closed).toBe(true);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({code:'friends/session-revoked'}));
    expect(cleanup).toHaveBeenCalledOnce();
    jobs[0].next('obsolete');
    expect(seen).not.toHaveBeenCalled();
    const current = observe().subscribe(seen);
    snapshots.next('new');
    jobs[1].next('current');
    expect(load).toHaveBeenCalledTimes(2);
    expect(seen).toHaveBeenCalledExactlyOnceWith('current');
    current.unsubscribe();
  });

  it('ends observation at termination before Firebase clears the user', () => {
    const { observe, session, uid$, cleanup } = setup();
    const error = vi.fn();
    const sub = observe().subscribe({error});
    session.terminationVersionSnapshot++;
    session.isTerminatingSnapshot = true;
    uid$.next(null);
    expect(sub.closed).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it('does not retain a failed listener or failed hydration', () => {
    const { watch, observe, snapshots, jobs, load } = setup();
    const error = vi.fn();
    observe().subscribe({error});
    snapshots.next('snapshot');
    jobs[0].error(new Error('failed hydration'));
    expect(error).toHaveBeenCalledOnce();
    const retry = watch.watch$('a',24,load,() => defer(() => of('recovered')));
    const result = vi.fn();
    const sub = retry.subscribe(result);
    snapshots.next('new');
    expect(result).toHaveBeenCalledExactlyOnceWith('recovered');
    expect(load).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });
});
