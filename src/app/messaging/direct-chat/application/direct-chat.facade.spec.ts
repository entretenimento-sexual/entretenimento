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

function buildDestroyRef(): DestroyRef {
  return {
    destroyed: false,
    onDestroy: () => () => undefined,
  } as unknown as DestroyRef;
}

function buildGlobalErrorHandler(): GlobalErrorHandlerService {
  return {
    handleError: () => undefined,
  } as unknown as GlobalErrorHandlerService;
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

    const facade = new DirectChatFacade(
      directChatService,
      authSession,
      firestoreUserQuery,
      buildGlobalErrorHandler(),
      buildDestroyRef()
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

  it('enriquece o chat com identidade e prévia públicas e deriva aliases legados', () => {
    const uidSubject = new BehaviorSubject<string | null>('user-a');
    const chats = new BehaviorSubject<IChat[]>([
      buildChat('chat-identity', ['user-a', 'peer-couple']),
    ]);
    const publicProfileId = 'profile-22222222-2222-4222-8222-222222222222';

    const directChatService = {
      getMyDirectChats$: () => chats.asObservable(),
      ensureDirectChatIdWithUser$: () => of(null),
    } as unknown as DirectChatService;

    const authSession = {
      uid$: uidSubject.asObservable(),
    } as unknown as AuthSessionService;

    const firestoreUserQuery = {
      getUsersPublicMap$: () => of({
        'peer-couple': {
          profileId: publicProfileId,
          nickname: 'casal_serale',
          avatarUrl: 'https://example.com/casal.webp',
          identityCode: 'casal-ele-ela',
          identityCatalogVersion: 1,
          identityLabel: 'texto não confiável',
          identityShortLabel: 'texto não confiável',
          identityDiscoveryGroup: 'couple',
          municipio: 'Rio de Janeiro',
          estado: 'RJ',
          age: 34,
          orientation: 'bissexual',
          isOnline: true,
          descricao: 'Perfil público para novas conexões.',
          preferenceBadgesVisible: true,
          publicRelationshipIntents: ['friendship'],
          publicBodyTraits: ['tattoos'],
          publicSexualPractices: ['bdsm'],
          cpf: 'não deve sair',
        },
      }),
    } as unknown as FirestoreUserQueryService;

    const facade = new DirectChatFacade(
      directChatService,
      authSession,
      firestoreUserQuery,
      buildGlobalErrorHandler(),
      buildDestroyRef()
    );

    const emissions: any[][] = [];
    const subscription = facade.items$.subscribe((items) => {
      emissions.push(items);
    });

    const item = last(emissions)?.[0];
    expect(item?.otherParticipantIdentity).toEqual({
      profileId: publicProfileId,
      nickname: 'casal_serale',
      label: 'casal_serale',
      avatarUrl: 'https://example.com/casal.webp',
      identityCode: 'casal-ele-ela',
      identityLabel: 'Casal (Ele/Ela)',
      identityShortLabel: 'Casal',
      discoveryGroup: 'couple',
      city: 'Rio de Janeiro',
      state: 'RJ',
      profileType: 'couple',
      profileTypeLabel: 'Casal',
    });
    expect(item?.otherParticipantPreview).toMatchObject({
      age: 34,
      orientationLabel: 'bissexual',
      isOnline: true,
      approximateDistanceKm: null,
      bioPreview: 'Perfil público para novas conexões.',
      highlights: ['Amizade', 'Tatuagens', 'BDSM'],
      identity: {
        profileId: publicProfileId,
        nickname: 'casal_serale',
        identityShortLabel: 'Casal',
        city: 'Rio de Janeiro',
        state: 'RJ',
      },
    });
    expect(item?.otherParticipantNickname).toBe('casal_serale');
    expect(item?.otherParticipantPhotoURL).toBe('https://example.com/casal.webp');
    expect('cpf' in (item?.otherParticipantIdentity ?? {})).toBe(false);
    expect('cpf' in (item?.otherParticipantPreview ?? {})).toBe(false);

    subscription.unsubscribe();
  });
});