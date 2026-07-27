// src/app/messaging/direct-chat/application/direct-chat.facade.spec.ts
import { DestroyRef } from '@angular/core';
import { BehaviorSubject, Observable, of, Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { FirestoreUserQueryService } from '@core/services/data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';
import { DirectChatService } from '../services/direct-chat.service';
import { DirectChatFacade } from './direct-chat.facade';

function buildChat(id: string, participants: string[]): IChat {
  return {
    id,
    participants,
    isRoom: false,
  } as IChat;
}

function last<T>(values: T[]): T | undefined {
  return values[values.length - 1];
}

describe('DirectChatFacade session isolation', () => {
  it('limpa dados e seleção em troca de UID e novo login', () => {
    let currentUid: string | null = 'user-a';
    const uidSubject = new BehaviorSubject<string | null>(currentUid);

    const userAChats = new BehaviorSubject<IChat[]>([
      buildChat('shared-chat', ['user-a', 'peer-a']),
    ]);
    const userBChats = new Subject<IChat[]>();

    const directChatService = {
      getMyDirectChats$: (): Observable<IChat[]> => {
        if (currentUid === 'user-a') return userAChats.asObservable();
        if (currentUid === 'user-b') return userBChats.asObservable();
        return of([] as IChat[]);
      },
      ensureDirectChatIdWithUser$: () => of(null),
    } as unknown as DirectChatService;

    const authSession = {
      uid$: uidSubject.asObservable(),
    } as unknown as AuthSessionService;

    const firestoreUserQuery = {
      getUsersPublicMap$: () => of({}),
    } as unknown as FirestoreUserQueryService;

    const globalErrorHandler = {
      handleError: () => undefined,
    } as unknown as GlobalErrorHandlerService;

    const destroyRef = {
      destroyed: false,
      onDestroy: () => () => undefined,
    } as unknown as DestroyRef;

    const facade = new DirectChatFacade(
      directChatService,
      authSession,
      firestoreUserQuery,
      globalErrorHandler,
      destroyRef
    );

    const chatEmissions: IChat[][] = [];
    const selectedEmissions: Array<string | null> = [];

    const chatsSubscription = facade.chats$.subscribe((chats) => {
      chatEmissions.push(chats);
    });
    const selectedSubscription = facade.selectedChatId$.subscribe((chatId) => {
      selectedEmissions.push(chatId);
    });

    facade.selectChat('shared-chat');
    expect(last(selectedEmissions)).toBe('shared-chat');

    currentUid = 'user-b';
    uidSubject.next(currentUid);

    expect(last(chatEmissions)).toEqual([]);
    expect(last(selectedEmissions)).toBeNull();

    userAChats.next([
      buildChat('old-account-chat', ['user-a', 'peer-a']),
    ]);
    expect(last(chatEmissions)).toEqual([]);

    userBChats.next([
      buildChat('shared-chat', ['user-b', 'peer-b']),
    ]);

    expect(last(chatEmissions)?.[0]?.participants).toEqual([
      'user-b',
      'peer-b',
    ]);
    expect(last(selectedEmissions)).toBeNull();

    facade.selectChat('shared-chat');
    expect(last(selectedEmissions)).toBe('shared-chat');

    currentUid = null;
    uidSubject.next(null);
    expect(last(chatEmissions)).toEqual([]);
    expect(last(selectedEmissions)).toBeNull();

    currentUid = 'user-b';
    uidSubject.next(currentUid);
    userBChats.next([
      buildChat('shared-chat', ['user-b', 'peer-b']),
    ]);

    expect(last(selectedEmissions)).toBeNull();

    chatsSubscription.unsubscribe();
    selectedSubscription.unsubscribe();
  });
});
