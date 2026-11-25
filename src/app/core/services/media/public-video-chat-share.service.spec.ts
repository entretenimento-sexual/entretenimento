import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaApplicationErrorService } from './media-application-error.service';
import { PublicVideoChatShareService } from './public-video-chat-share.service';

describe('PublicVideoChatShareService session boundary', () => {
  const params = { chatId: 'chat_1', expectedActorUid: 'viewer_1', ownerUid: 'owner_1', videoId: 'video_1' };
  let uid$: BehaviorSubject<string | null>;
  let callable: ReturnType<typeof vi.fn>;
  let report: ReturnType<typeof vi.fn>;
  let service: PublicVideoChatShareService;

  beforeEach(() => {
    uid$ = new BehaviorSubject<string | null>('viewer_1');
    callable = vi.fn().mockResolvedValue({ data: { chatId: 'chat_1', messageId: 'message_1' } });
    report = vi.fn();
    TestBed.configureTestingModule({ providers: [
      { provide: Functions, useValue: {} },
      { provide: AuthSessionService, useValue: { uid$ } },
      { provide: ErrorNotificationService, useValue: { showWarning: vi.fn() } },
      { provide: MediaApplicationErrorService, useValue: { report } },
    ] });
    service = TestBed.inject(PublicVideoChatShareService);
    Object.assign(service, { callable });
  });

  it('envia o UID esperado separado do proprietário do vídeo', async () => {
    expect(await firstValueFrom(service.sendToChat$(params))).toBe('message_1');
    expect(callable).toHaveBeenCalledWith({
      chatId: 'chat_1', expectedActorUid: 'viewer_1', clientRequestId: expect.any(String),
      publicVideoReference: { ownerUid: 'owner_1', videoId: 'video_1' },
    });
  });

  it('não despacha intenção antiga após logout e login no mesmo UID', async () => {
    const request$ = service.sendToChat$(params);
    uid$.next(null);
    uid$.next('viewer_1');
    expect(await firstValueFrom(request$)).toBeNull();
    uid$.next('viewer_2');
    expect(await firstValueFrom(service.sendToChat$(params))).toBeNull();
    expect(callable).not.toHaveBeenCalled();
  });

  it('cancela resposta e erro tardios ao trocar de sessão', async () => {
    let reject!: (error: Error) => void;
    callable.mockImplementation(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const next = vi.fn();
    const complete = vi.fn();
    service.sendToChat$(params).subscribe({ next, complete });
    expect(callable).toHaveBeenCalledTimes(1);
    uid$.next('viewer_2');
    expect(complete).toHaveBeenCalledTimes(1);
    reject(new Error('late'));
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('não confirma resposta de outra conversa', async () => {
    callable.mockResolvedValue({ data: { chatId: 'chat_2', messageId: 'message_2' } });
    expect(await firstValueFrom(service.sendToChat$(params))).toBeNull();
  });
});
