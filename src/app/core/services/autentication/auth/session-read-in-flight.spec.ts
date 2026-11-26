import type { User } from 'firebase/auth';
import { BehaviorSubject, defer, firstValueFrom, from, Observable, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SessionReadInFlight } from './session-read-in-flight';

function setup() {
  const user = (uid: string) => ({ uid } as User);
  const uid$ = new BehaviorSubject<string | null>('a');
  const session = {
    currentAuthUser: user('a') as User | null,
    uid$,
    terminationVersionSnapshot: 0,
    isTerminatingSnapshot: false,
  };
  return { user, session, uid$, reads: new SessionReadInFlight<string>(session) };
}

describe('SessionReadInFlight', () => {
  it('deduplica em voo mesmo após desmontar a rota e não guarda resultado', async () => {
    const { reads } = setup();
    let resolve!: (value: string) => void;
    const load = vi.fn(() => from(new Promise<string>(done => { resolve = done; })));
    const obsolete = reads.read$('page', load).subscribe();
    obsolete.unsubscribe();
    const a = firstValueFrom(reads.read$('page', load));
    const b = firstValueFrom(reads.read$('page', load));
    expect(load).toHaveBeenCalledTimes(1);
    resolve('fresh');
    expect(await Promise.all([a, b])).toEqual(['fresh', 'fresh']);
    const freshLoad = vi.fn(() => of('another'));
    await expect(firstValueFrom(reads.read$('page', freshLoad))).resolves.toBe('another');
    expect(freshLoad).toHaveBeenCalledOnce();
  });

  it('não mistura chaves, UIDs nem restauração do mesmo UID', async () => {
    const { reads, session, uid$, user } = setup();
    const seen: string[] = [];
    let resolveOld!: (value: string) => void;
    const old = reads.read$('page', () => from(new Promise<string>(done => { resolveOld = done; })))
      .subscribe(value => seen.push(value));
    await expect(firstValueFrom(reads.read$('other', () => of('different')))).resolves.toBe('different');
    session.currentAuthUser = user('b');
    uid$.next('b');
    expect(old.closed).toBe(true);
    await expect(firstValueFrom(reads.read$('page', () => of('b')))).resolves.toBe('b');
    session.terminationVersionSnapshot++;
    session.currentAuthUser = user('a');
    uid$.next('a');
    await expect(firstValueFrom(reads.read$('page', () => of('new-a')))).resolves.toBe('new-a');
    resolveOld('old-a');
    await Promise.resolve();
    expect(seen).toEqual([]);
  });

  it('revoga no início do logout, mesmo antes de o Firebase limpar currentUser', async () => {
    const { reads, session, uid$ } = setup();
    let resolve!: (value: string) => void;
    const seen: string[] = [];
    const sub = reads.read$('page', () => from(new Promise<string>(done => { resolve = done; })))
      .subscribe(value => seen.push(value));
    session.isTerminatingSnapshot = true;
    session.terminationVersionSnapshot++;
    uid$.next(null);
    expect(sub.closed).toBe(true);
    const load = vi.fn(() => of('not allowed'));
    await expect(firstValueFrom(reads.read$('page', load))).rejects.toMatchObject({
      code: 'functions/unauthenticated',
    });
    expect(load).not.toHaveBeenCalled();
    session.isTerminatingSnapshot = false;
    uid$.next('a');
    await expect(firstValueFrom(reads.read$('page', () => of('restored')))).resolves.toBe('restored');
    resolve('stale');
    await Promise.resolve();
    expect(seen).toEqual([]);
  });

  it('não propaga erro tardio de instância substituída sem alteração do UID', async () => {
    const { reads, session, user } = setup();
    let rejectOld!: (error: unknown) => void;
    const onError = vi.fn();
    const onComplete = vi.fn();
    reads.read$('page', () => from(new Promise<string>((_resolve, reject) => {
      rejectOld = reject;
    }))).subscribe({ error: onError, complete: onComplete });
    session.currentAuthUser = user('a');
    await expect(firstValueFrom(reads.read$('page', () => of('new')))).resolves.toBe('new');
    rejectOld(new Error('old permission-denied'));
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('libera leitura retida quando authUser emite outra instância do mesmo UID', async () => {
    const { session, user } = setup();
    const authUser$ = new BehaviorSubject<User | null>(session.currentAuthUser);
    const reads = new SessionReadInFlight<string>({ ...session, authUser$,
      get currentAuthUser() { return session.currentAuthUser; } });
    const cleanup = vi.fn();
    const old = reads.read$('page', () => new Observable<string>(() => cleanup)).subscribe();
    old.unsubscribe();
    expect(cleanup).not.toHaveBeenCalled();
    session.currentAuthUser = user('a');
    authUser$.next(session.currentAuthUser);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(authUser$.observers).toHaveLength(0);
    await expect(firstValueFrom(reads.read$('page', () => of('new')))).resolves.toBe('new');
    expect(authUser$.observers).toHaveLength(0);
  });

  it('propaga erros e libera a chave para nova tentativa', async () => {
    const { reads } = setup();
    const error = new Error('permission-denied');
    await expect(firstValueFrom(reads.read$('page', () => defer(() => { throw error; })))).rejects.toBe(error);
    await expect(firstValueFrom(reads.read$('page', () => of('new')))).resolves.toBe('new');
  });
});
