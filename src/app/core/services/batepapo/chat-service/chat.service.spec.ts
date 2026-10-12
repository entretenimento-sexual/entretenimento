import { BehaviorSubject, firstValueFrom, of, Subject, throwError, type Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';

import { ChatService } from './chat.service';

function createHarness() {
  const uid$ = new BehaviorSubject<string | null>('user-1');
  const ready$ = new BehaviorSubject(true);
  const blockReason$ = new BehaviorSubject<string | null>(null);
  const authSession = {
    ready$,
    authUser$: of({ uid: 'user-1', emailVerified: true }),
    uid$,
  };

  const appBlock = {
    reason$: blockReason$,
  };

  const cache = {
    get: vi.fn(() => of(null)),
    set: vi.fn(),
  };

  const chatsRepo = {
    findChatIdByParticipantsKey$: vi.fn(),
    createChat$: vi.fn(),
    updateChat$: vi.fn(),
    deleteChat$: vi.fn(),
    watchChats$: vi.fn(),
  };
  const msgsRepo = {
    addMessage$: vi.fn(),
    deleteMessage$: vi.fn(),
    updateMessageStatus$: vi.fn(),
    setMessageReaction$: vi.fn(),
    watchMessages$: vi.fn(),
    getMessagesPageOnce$: vi.fn(),
  };

  const applicationError = {
    report: vi.fn(),
  };

  const service = new ChatService(
    authSession as any,
    appBlock as any,
    cache as any,
    chatsRepo as any,
    msgsRepo as any,
    applicationError as unknown as ApplicationErrorService
  );

  return { service, applicationError, uid$, ready$, blockReason$, msgsRepo, chatsRepo, cache };
}

describe('ChatService canonical errors', () => {
  it('não recria listener legado de mensagens em emissões idênticas de sessão', () => {
    const { service, uid$, ready$, msgsRepo } = createHarness();
    const snapshots = new Subject<any[]>();
    msgsRepo.watchMessages$.mockReturnValue(snapshots.asObservable());
    const subscription = service.monitorChat('chat-1').subscribe();
    expect(msgsRepo.watchMessages$).toHaveBeenCalledTimes(1);
    uid$.next('user-1');
    ready$.next(true);
    uid$.next('user-1');
    expect(msgsRepo.watchMessages$).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
    expect(snapshots.observers).toHaveLength(0);
  });

  it('encaminha cursor composto e mantém carregamento inicial compatível', async () => {
    const { service, msgsRepo } = createHarness();
    const timestamp = { seconds: 100, nanoseconds: 0 } as any;
    msgsRepo.getMessagesPageOnce$.mockReturnValue(of([{ id: 'older-1' }]));
    const page = await firstValueFrom(service.getMessages('chat-1', timestamp, 'older-2'));
    expect(page).toEqual([{ id: 'older-1' }]);
    expect(msgsRepo.getMessagesPageOnce$).toHaveBeenCalledWith(
      'chat-1', timestamp, 20, 'older-2'
    );
    await firstValueFrom(service.getMessages('chat-1'));
    expect(msgsRepo.getMessagesPageOnce$).toHaveBeenLastCalledWith(
      'chat-1', undefined, 20, undefined
    );
  });


  it('reporta erro técnico uma única vez e o mantém silencioso', async () => {
    const { service, applicationError } = createHarness();
    const error = new Error('repository failed');

    const silent$ = (
      service as unknown as {
        reportSilent(action: string, error: unknown): ReturnType<
          ChatService['getMessages']
        >;
      }
    ).reportSilent('getMessages', error);

    await expect(firstValueFrom(silent$)).rejects.toBe(error);

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(error, {
      feature: 'chat',
      operation: 'getMessages',
      fallbackMessage:
        'Não foi possível concluir uma operação interna do chat.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'ChatService',
        action: 'getMessages',
      },
    });
    expect((error as any).chatApplicationErrorReported).toBe(true);

    const outer$ = (
      service as unknown as {
        reportSilent(action: string, error: unknown): ReturnType<
          ChatService['getMessages']
        >;
      }
    ).reportSilent('sendMessage', error);

    await expect(firstValueFrom(outer$)).rejects.toBe(error);
    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });

  it('recibo rejeitado propaga falha com diagnóstico único', async () => {
    const { service, applicationError, msgsRepo } = createHarness();
    const failure = new Error('permission-denied');
    msgsRepo.updateMessageStatus$.mockReturnValue(
      throwError(() => failure)
    );

    await expect(firstValueFrom(
      service.updateMessageStatus('chat-1', 'message-1', 'delivered')
    )).rejects.toBe(failure);
    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });

  it('recibo não publica erro tardio de outra sessão', () => {
    const { service, applicationError, msgsRepo, uid$ } = createHarness();
    const pending = new Subject<void>();
    msgsRepo.updateMessageStatus$.mockReturnValue(pending.asObservable());
    const values: void[] = [];
    const subscription = service.updateMessageStatus(
      'chat-1', 'message-1', 'delivered'
    ).subscribe((value) => values.push(value));

    uid$.next('user-2');
    pending.error(new Error('stale receipt failure'));
    expect(values).toEqual([]);
    expect(applicationError.report).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it('reação não publica erro tardio após bloqueio da sessão', () => {
    const { service, applicationError, msgsRepo, blockReason$ } = createHarness();
    const pending = new Subject<void>();
    msgsRepo.setMessageReaction$.mockReturnValue(pending.asObservable());
    const values: void[] = [];
    const subscription = service.setMessageReaction(
      'chat-1', 'message-1', '❤️'
    ).subscribe((value) => values.push(value));

    blockReason$.next('revoked');
    pending.error(new Error('stale reaction failure'));
    expect(values).toEqual([]);
    expect(applicationError.report).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it('limita realtime a 60 mensagens sem modificar páginas históricas de 20', async () => {
    const { service, msgsRepo } = createHarness();
    const latest = [{ id: 'recent' }];
    msgsRepo.watchMessages$.mockReturnValue(of(latest));
    msgsRepo.getMessagesPageOnce$.mockReturnValue(of([{ id: 'older' }]));

    expect(await firstValueFrom(service.monitorChat('chat-1'))).toEqual(latest);
    expect(msgsRepo.watchMessages$).toHaveBeenCalledWith('chat-1', 60);

    const cursor = { seconds: 42, nanoseconds: 0 } as any;
    expect(await firstValueFrom(service.getMessages('chat-1', cursor, 'older-cursor')))
      .toEqual([{ id: 'older' }]);
    expect(msgsRepo.getMessagesPageOnce$).toHaveBeenCalledWith(
      'chat-1', cursor, 20, 'older-cursor'
    );
  });

  it('propaga erro do listener em vez de apresentar falha como conversa vazia', async () => {
    const { service, msgsRepo, applicationError } = createHarness();
    const failure = Object.assign(new Error('access revoked'), { code: 'permission-denied' });
    msgsRepo.watchMessages$.mockReturnValue(throwError(() => failure));

    await expect(firstValueFrom(service.monitorChat('chat-1'))).rejects.toBe(failure);
    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(msgsRepo.watchMessages$).toHaveBeenCalledWith('chat-1', 60);
  });

  it('encerra listener de mensagens durante troca de UID mesmo com ambas as contas aptas', () => {
    const { service, uid$, msgsRepo } = createHarness();
    const messages$ = new Subject<any[]>();
    msgsRepo.watchMessages$ = vi.fn(() => messages$.asObservable());
    const values: any[][] = [];
    const subscription = service.monitorChat('chat-1').subscribe(value => values.push(value));

    expect(msgsRepo.watchMessages$).toHaveBeenCalledTimes(1);
    expect(messages$.observers.length).toBe(1);

    uid$.next('user-2');

    expect(messages$.observers.length).toBe(0);
    expect(values.at(-1)).toEqual([]);
    subscription.unsubscribe();
  });

  it('não consulta cache nem abre chats de outro UID após troca de sessão', async () => {
    const { service, uid$, chatsRepo, cache } = createHarness();
    uid$.next('user-2');

    await expect(firstValueFrom(service.getChats('user-1'))).resolves.toEqual([]);
    expect(cache.get).not.toHaveBeenCalled();
    expect(chatsRepo.watchChats$).not.toHaveBeenCalled();
  });

  it('encerra listener de lista de chats ao alterar o UID', () => {
    const { service, uid$, chatsRepo } = createHarness();
    const chats$ = new Subject<any[]>();
    chatsRepo.watchChats$ = vi.fn(() => chats$.asObservable());
    const received: any[][] = [];
    const subscription = service.watchChats$('user-1').subscribe(value => received.push(value));

    expect(chats$.observers.length).toBe(1);
    uid$.next('user-2');
    expect(chats$.observers.length).toBe(0);
    expect(received.at(-1)).toEqual([]);
    subscription.unsubscribe();
  });

  it('operações legadas de chat falham sem acessar cache ou repositório', async () => {
    const { service, applicationError, chatsRepo, msgsRepo, cache } = createHarness();

    const operations = [
      service.getOrCreateChatId(['user-1', 'user-2']),
      service.createChat(['user-1', 'user-2']),
      service.updateChat('chat-1', { participants: ['user-1', 'user-2'] }),
      service.deleteChat('chat-1'),
      service.deleteMessage('chat-1', 'msg-1'),
      service.sendMessage('chat-1', { content: 'privada' } as any, 'user-1'),
    ];
    for (const operation of operations) {
      await expect(firstValueFrom(operation as Observable<unknown>)).rejects.toMatchObject({
        code: 'failed-precondition',
      });
    }

    expect(cache.get).not.toHaveBeenCalled();
    for (const mock of Object.values(chatsRepo)) {
      expect(mock).not.toHaveBeenCalled();
    }
    expect(msgsRepo.addMessage$).not.toHaveBeenCalled();
    expect(msgsRepo.deleteMessage$).not.toHaveBeenCalled();
    expect(applicationError.report).toHaveBeenCalledTimes(operations.length);
    expect(applicationError.report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        presentation: { surface: 'none', severity: 'error' },
      })
    );
  });

  it('enrichment legado não consulta perfil privado nem grava dados de terceiros', async () => {
    const { service, chatsRepo } = createHarness();

    await expect(firstValueFrom(
      service.fetchAndPersistParticipantDetails('chat-1', 'user-2')
    )).resolves.toBeNull();
    expect(service.refreshParticipantDetailsIfNeeded('chat-1')).toBeUndefined();
    expect(chatsRepo.updateChat$).not.toHaveBeenCalled();
  });

  it('preserva valor original quando precisa criar um Error para falha não-Error', async () => {
    const { service, applicationError } = createHarness();
    const source = { code: 'firestore/unavailable' };

    const silent$ = (
      service as unknown as {
        reportSilent(action: string, error: unknown): ReturnType<
          ChatService['getMessages']
        >;
      }
    ).reportSilent('watchChats$', source);

    let thrown: unknown;
    try {
      await firstValueFrom(silent$);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as any).original).toBe(source);
    expect(applicationError.report).toHaveBeenCalledTimes(1);
  });
});
