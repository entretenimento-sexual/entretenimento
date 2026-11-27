import type { User } from 'firebase/auth';
import type { Friend } from '../../../../interfaces/friendship/friend.interface';
import { EndedFriendshipFence } from './ended-friendship-fence';

describe('EndedFriendshipFence / confirmação canônica', () => {
  const user = (uid: string) => ({ uid } as User);
  const cutoff = { seconds: 100, nanoseconds: 123456000 };
  const old: Friend = { friendUid: 'peer', sinceVersion: { seconds: 100, nanoseconds: 123455000 } };
  const newEdge: Friend = { friendUid: 'peer', sinceVersion: { seconds: 100, nanoseconds: 123457000 } };
  const other: Friend = { friendUid: 'other' };
  function setup() {
    const session = { currentAuthUser: user('owner') as User | null,
      terminationVersionSnapshot: 0, isTerminatingSnapshot: false };
    const fence = new EndedFriendshipFence(session);
    return { session, fence };
  }
  it('não restaura geração removida, mesmo após ausência, nova relação ou passagem do tempo', () => {
    const { fence } = setup();
    expect(fence.filter('owner', [old, other])).toEqual([old, other]);
    fence.capture('owner','peer')(cutoff);
    expect(fence.filter('owner', [old, other])).toEqual([other]);
    expect(fence.filter('owner', [])).toEqual([]);
    expect(fence.filter('owner', [newEdge, other])).toEqual([newEdge, other]);
    // Uma resposta iniciada antes da confirmação pode terminar arbitrariamente tarde.
    expect(fence.filter('owner', [old, other])).toEqual([other]);
    expect(fence.filter('owner', [{ friendUid: 'peer' }])).toEqual([]);
    expect(fence.filter('owner', [{ friendUid: 'peer', sinceVersion: cutoff }])).toEqual([]);
  });
  it('não rebaixa a fronteira se retornos de encerramento chegarem fora de ordem', () => {
    const { fence } = setup();
    const a = fence.capture('owner','peer'), b = fence.capture('owner','peer');
    b({ seconds: 101, nanoseconds: 0 });
    a(cutoff);
    expect(fence.filter('owner', [newEdge])).toEqual([]);
  });
  it('ignora confirmação da sessão antiga mesmo com UID igual', () => {
    const { session, fence } = setup();
    const confirm = fence.capture('owner','peer');
    session.currentAuthUser = user('owner');
    confirm(cutoff);
    expect(fence.filter('owner', [old])).toEqual([old]);
  });
  it('isola outro UID e invalida a sessão na terminação', () => {
    const { session, fence } = setup();
    fence.capture('owner','peer')(cutoff);
    session.isTerminatingSnapshot = true;
    session.terminationVersionSnapshot++;
    expect(fence.filter('owner', [old])).toEqual([]);
    session.currentAuthUser = user('other');
    session.isTerminatingSnapshot = false;
    expect(fence.filter('other', [old])).toEqual([old]);
    expect(fence.filter('owner', [old])).toEqual([]);
  });
  it('falha fechado em resposta sem fronteira canônica de backend antigo', () => {
    const { fence } = setup();
    fence.capture('owner','peer')(null);
    expect(fence.filter('owner', [old, newEdge, other])).toEqual([other]);
  });
});
