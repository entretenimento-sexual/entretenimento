import { BehaviorSubject, firstValueFrom, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { DirectReceiptsService } from './direct-receipts.service';

describe('DirectReceiptsService', () => {
  function setup(updateResult = of(void 0)) {
    const updateMessageStatus = vi.fn((_chatId: string, _messageId: string, _status: string) => updateResult as any);
    const report = vi.fn();
    const log = vi.fn();
    const uid = new BehaviorSubject<string | null>('me');
    const canListen = new BehaviorSubject(true);

    const service = new DirectReceiptsService(
      { updateMessageStatus } as any,
      { report } as any,
      { log } as any,
      {
        authUid$: uid.asObservable(),
        canListenRealtime$: canListen.asObservable(),
      } as any
    );

    return { service, updateMessageStatus, report, log, uid, canListen };
  }

  it('avança sent para delivered e delivered para read', async () => {
    const { service, updateMessageStatus } = setup();

    const count = await firstValueFrom(
      service.markDeliveredAsRead$('chat-1', 'me', [
        {
          id: 'm1',
          senderId: 'peer',
          status: 'sent',
        } as any,
        {
          id: 'm2',
          senderId: 'peer',
          status: 'delivered',
        } as any,
        {
          id: 'm3',
          senderId: 'me',
          status: 'sent',
        } as any,
      ])
    );

    expect(count).toBe(2);
    expect(updateMessageStatus).toHaveBeenNthCalledWith(
      1,
      'chat-1',
      'm1',
      'delivered'
    );
    expect(updateMessageStatus).toHaveBeenNthCalledWith(
      2,
      'chat-1',
      'm2',
      'read'
    );
  });

  it('mantém falha de update como best-effort e diagnostica silenciosamente', async () => {
    const error = new Error('receipt failed');
    const { service, report } = setup(throwError(() => error));

    const count = await firstValueFrom(
      service.markDeliveredAsRead$('chat-1', 'me', [
        {
          id: 'm1',
          senderId: 'peer',
          status: 'sent',
        } as any,
      ])
    );

    expect(count).toBe(0);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(error, {
      feature: 'direct-receipts',
      operation:
        'DirectReceiptsService.markDeliveredAsRead$.updateMessageStatus',
      fallbackMessage:
        'Não foi possível concluir uma atualização interna de recibo.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'DirectReceiptsService',
        context:
          'DirectReceiptsService.markDeliveredAsRead$.updateMessageStatus',
        chatId: 'chat-1',
        messageId: 'm1',
        nextStatus: 'delivered',
      },
    });
  });

  it('conta somente gravações confirmadas e não anuncia falhas como sucesso', async () => {
    const { service, updateMessageStatus, report, log } = setup();
    const error = new Error('permission-denied');
    updateMessageStatus.mockImplementation((_chatId: string, messageId: string) =>
      messageId === 'm2' ? throwError(() => error) : of(void 0)
    );
    const count = await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', [
      { id: 'm1', senderId: 'peer', status: 'sent' } as any,
      { id: 'm2', senderId: 'peer', status: 'delivered' } as any,
    ]));
    expect(count).toBe(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('chat', 'DirectReceiptsService: markDeliveredAsRead$', {
      chatId: 'chat-1',
      attemptedCount: 2,
      confirmedCount: 1,
      deliveredCount: 1,
      readCount: 0,
    });
  });

  it('não duplica diagnóstico já registrado no ChatService', async () => {
    const diagnosed = Object.assign(new Error('already diagnosed'), {
      chatApplicationErrorReported: true,
    });
    const { service, report } = setup(throwError(() => diagnosed));
    const count = await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', [
      { id: 'm1', senderId: 'peer', status: 'sent' } as any,
    ]));
    expect(count).toBe(0);
    expect(report).not.toHaveBeenCalled();
  });

  it('ignora mensagens apagadas, recibos terminais e IDs duplicados', async () => {
    const { service, updateMessageStatus } = setup();
    const count = await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', [
      { id: 'deleted', senderId: 'peer', status: 'sent', deleted: true } as any,
      { id: 'read', senderId: 'peer', status: 'read' } as any,
      { id: 'legacy-no-status', senderId: 'peer' } as any,
      { id: 'owned', senderId: 'peer', senderUid: 'me', status: 'sent' } as any,
      { id: 'm1', senderId: 'peer', status: 'sent' } as any,
      { id: 'm1', senderId: 'peer', status: 'sent' } as any,
    ]));
    expect(count).toBe(1);
    expect(updateMessageStatus).toHaveBeenCalledTimes(1);
    expect(updateMessageStatus).toHaveBeenCalledWith('chat-1', 'm1', 'delivered');
  });

  it('coalesce chamadas simultâneas para a mesma transição enquanto aguarda confirmação', async () => {
    const { service, updateMessageStatus } = setup();
    const pending = new Subject<void>();
    updateMessageStatus.mockReturnValue(pending.asObservable());
    const counts: number[] = [];
    const messages = [{ id: 'm1', senderId: 'peer', status: 'sent' } as any];
    const subscription = service.markDeliveredAsRead$('chat-1', 'me', messages)
      .subscribe((count: number) => counts.push(count));
    expect(updateMessageStatus).toHaveBeenCalledTimes(1);
    const duplicateCount = await firstValueFrom(
      service.markDeliveredAsRead$('chat-1', 'me', messages)
    );
    expect(duplicateCount).toBe(0);
    expect(updateMessageStatus).toHaveBeenCalledTimes(1);
    pending.next();
    pending.complete();
    expect(counts).toEqual([1]);
    subscription.unsubscribe();
  });

  it('não bloqueia delivered -> read quando a confirmação de delivered ainda está pendente', () => {
    const { service, updateMessageStatus } = setup();
    const delivered = new Subject<void>();
    const read = new Subject<void>();
    updateMessageStatus.mockImplementation((_chat: string, _id: string, status: string) =>
      status === 'delivered' ? delivered.asObservable() : read.asObservable()
    );
    const counts: number[] = [];
    const subA = service.markDeliveredAsRead$('chat-1', 'me', [
      { id: 'm1', senderId: 'peer', status: 'sent' } as any,
    ]).subscribe((count: number) => counts.push(count));
    const subB = service.markDeliveredAsRead$('chat-1', 'me', [
      { id: 'm1', senderId: 'peer', status: 'delivered' } as any,
    ]).subscribe((count: number) => counts.push(count));
    expect(updateMessageStatus).toHaveBeenCalledTimes(2);
    delivered.next();
    delivered.complete();
    read.next();
    read.complete();
    expect(counts).toEqual([1, 1]);
    subA.unsubscribe();
    subB.unsubscribe();
  });

  it('encerra recibo pendente sem erro visível após revogação de acesso', () => {
    const { service, updateMessageStatus, report, canListen } = setup();
    const pending = new Subject<void>();
    updateMessageStatus.mockReturnValue(pending.asObservable());
    const counts: number[] = [];
    const sub = service.markDeliveredAsRead$('chat-1', 'me', [
      { id: 'm1', senderId: 'peer', status: 'sent' } as any,
    ]).subscribe((count: number) => counts.push(count));
    canListen.next(false);
    pending.error(new Error('revoked'));
    expect(counts).toEqual([]);
    expect(report).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('não atualiza recibos quando o UID fornecido pertence a outra sessão', async () => {
    const { service, uid, updateMessageStatus } = setup();
    uid.next('other-user');
    const count = await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', [
      { id: 'm1', senderId: 'peer', status: 'sent' } as any,
    ]));
    expect(count).toBe(0);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  it('descarta atualização de recibo pendente após troca A para B', () => {
    const { service, uid, updateMessageStatus } = setup();
    const pending = new Subject<void>();
    updateMessageStatus.mockReturnValue(pending.asObservable());
    const counts: number[] = [];
    const sub = service.markDeliveredAsRead$('chat-1', 'me', [
      { id: 'm1', senderId: 'peer', status: 'sent' } as any,
    ]).subscribe((count: number) => counts.push(count));
    expect(updateMessageStatus).toHaveBeenCalledTimes(1);
    uid.next('other-user');
    pending.next();
    pending.complete();
    expect(counts).toEqual([]);
    sub.unsubscribe();
  });

  it('limita a cinco escritas simultâneas mesmo com cinquenta mensagens', () => {
    const { service, updateMessageStatus } = setup();
    const pending = Array.from({ length: 50 }, () => new Subject<void>());
    let requested = 0;
    updateMessageStatus.mockImplementation(() => pending[requested++].asObservable());
    const messages = Array.from({ length: 50 }, (_, index) => ({
      id: `msg-${index}`, senderId: 'peer', status: 'sent',
    })) as any;
    const counts: number[] = [];
    const subscription = service.markDeliveredAsRead$('chat-1', 'me', messages)
      .subscribe(count => counts.push(count));

    expect(requested).toBe(5);
    for (let index = 0; index < 50; index += 1) {
      pending[index].next();
      pending[index].complete();
      expect(requested).toBe(Math.min(50, index + 6));
    }
    expect(counts).toEqual([50]);
    expect(updateMessageStatus).toHaveBeenCalledTimes(50);
    subscription.unsubscribe();
  });

  it('revogação cancela escritas pendentes e não inicia itens enfileirados', () => {
    const { service, updateMessageStatus, canListen } = setup();
    const pending = new Subject<void>();
    updateMessageStatus.mockReturnValue(pending.asObservable());
    const messages = Array.from({ length: 25 }, (_, index) => ({
      id: `pending-${index}`, senderId: 'peer', status: 'sent',
    })) as any;
    const counts: number[] = [];
    const subscription = service.markDeliveredAsRead$('chat-1', 'me', messages)
      .subscribe(value => counts.push(value));

    expect(updateMessageStatus).toHaveBeenCalledTimes(5);
    canListen.next(false);
    expect(pending.observers.length).toBe(0);
    pending.next();
    pending.complete();
    expect(updateMessageStatus).toHaveBeenCalledTimes(5);
    expect(counts).toEqual([]);
    subscription.unsubscribe();
  });

  it('deduplica confirmação em snapshots antigos e mantém avanço para read', async () => {
    const { service, updateMessageStatus } = setup();
    const sent = [{ id: 'repeat', senderId: 'peer', status: 'sent' }] as any;
    const delivered = [{ id: 'repeat', senderId: 'peer', status: 'delivered' }] as any;
    expect(await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', sent))).toBe(1);
    expect(await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', sent))).toBe(0);
    expect(await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', delivered))).toBe(1);
    expect(await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', delivered))).toBe(0);
    expect(updateMessageStatus).toHaveBeenCalledTimes(2);
  });

  it('não reutiliza confirmação depois de troca de UID', async () => {
    const { service, updateMessageStatus, uid } = setup();
    const messages = [{ id: 'session-msg', senderId: 'peer', status: 'sent' }] as any;
    expect(await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', messages))).toBe(1);
    uid.next(null);
    expect(await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', messages))).toBe(0);
    uid.next('me');
    expect(await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', messages))).toBe(1);
    expect(updateMessageStatus).toHaveBeenCalledTimes(2);
  });

  it('limpa confirmação no logout mesmo sem operação durante a sessão encerrada', async () => {
    const { service, updateMessageStatus, uid } = setup();
    const messages = [{ id: 'logout-msg', senderId: 'peer', status: 'sent' }] as any;
    expect(await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', messages))).toBe(1);
    uid.next(null);
    uid.next('me');
    expect(await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', messages))).toBe(1);
    expect(updateMessageStatus).toHaveBeenCalledTimes(2);
  });

  it('falha de escrita não ativa deduplicação temporal', async () => {
    const { service, updateMessageStatus } = setup();
    updateMessageStatus.mockImplementationOnce(() => throwError(() => new Error('offline')));
    const messages = [{ id: 'retry-msg', senderId: 'peer', status: 'sent' }] as any;
    expect(await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', messages))).toBe(0);
    expect(await firstValueFrom(service.markDeliveredAsRead$('chat-1', 'me', messages))).toBe(1);
    expect(updateMessageStatus).toHaveBeenCalledTimes(2);
  });

  it('ignora input inválido sem tocar no adapter', async () => {
    const { service, updateMessageStatus, report } = setup();

    const count = await firstValueFrom(
      service.markDeliveredAsRead$(' ', 'me', [])
    );

    expect(count).toBe(0);
    expect(updateMessageStatus).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});
