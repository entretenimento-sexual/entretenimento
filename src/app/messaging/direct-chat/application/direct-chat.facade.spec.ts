// src/app/messaging/direct-chat/application/direct-chat.facade.spec.ts
import { DestroyRef } from '@angular/core';
import {
  BehaviorSubject,
  firstValueFrom,
  Observable,
  of,
  Subject,
  throwError,
} from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { FirestoreUserQueryService } from '@core/services/data-handling/firestore-user-query.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
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

function buildApplicationError() {
  const report = vi.fn();

  return {
    report,
    service: {
      report,
    } as unknown as ApplicationErrorService,
  };
}

function buildAuthSession(
  uidSubject: BehaviorSubject<string | null>
): AuthSessionService {
  return {
    uid$: uidSubject.asObservable(),
  } as unknown as AuthSessionService;
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

    const firestoreUserQuery = {
      getUsersPublicMap$: () => of({}),
    } as unknown as FirestoreUserQueryService;

    const applicationError = buildApplicationError();

    const facade = new DirectChatFacade(
      directChatService,
      buildAuthSession(uidSubject),
      firestoreUserQuery,
      applicationError.service,
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
    expect(applicationError.report).not.toHaveBeenCalled();

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

    const applicationError = buildApplicationError();

    const facade = new DirectChatFacade(
      directChatService,
      buildAuthSession(uidSubject),
      firestoreUserQuery,
      applicationError.service,
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
    expect(applicationError.report).not.toHaveBeenCalled();

    subscription.unsubscribe();
  });
});

describe('DirectChatFacade canonical errors', () => {
  it('mantém falha do listener silenciosa e devolve lista vazia', async () => {
    const uidSubject = new BehaviorSubject<string | null>('user-a');
    const error = new Error('listener failed');
    const applicationError = buildApplicationError();

    const directChatService = {
      getMyDirectChats$: () => throwError(() => error),
      ensureDirectChatIdWithUser$: () => of(null),
    } as unknown as DirectChatService;

    const firestoreUserQuery = {
      getUsersPublicMap$: () => of({}),
    } as unknown as FirestoreUserQueryService;

    const facade = new DirectChatFacade(
      directChatService,
      buildAuthSession(uidSubject),
      firestoreUserQuery,
      applicationError.service,
      buildDestroyRef()
    );

    const emissions: IChat[][] = [];
    const subscription = facade.chats$.subscribe((items) => {
      emissions.push(items);
    });

    expect(last(emissions)).toEqual([]);
    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(error, {
      feature: 'direct-chat',
      operation: 'DirectChatFacade.sessionChats$',
      fallbackMessage:
        'Não foi possível concluir uma operação interna do chat direto.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'DirectChatFacade',
        context: 'DirectChatFacade.sessionChats$',
      },
    });

    subscription.unsubscribe();
  });

  it('mantém itens básicos quando o enriquecimento público falha', () => {
    const uidSubject = new BehaviorSubject<string | null>('user-a');
    const error = new Error('public profile unavailable');
    const applicationError = buildApplicationError();

    const directChatService = {
      getMyDirectChats$: () =>
        of([buildChat('chat-1', ['user-a', 'peer-b'])]),
      ensureDirectChatIdWithUser$: () => of(null),
    } as unknown as DirectChatService;

    const firestoreUserQuery = {
      getUsersPublicMap$: () => throwError(() => error),
    } as unknown as FirestoreUserQueryService;

    const facade = new DirectChatFacade(
      directChatService,
      buildAuthSession(uidSubject),
      firestoreUserQuery,
      applicationError.service,
      buildDestroyRef()
    );

    const emissions: any[][] = [];
    const subscription = facade.items$.subscribe((items) => {
      emissions.push(items);
    });

    const item = last(emissions)?.[0];
    expect(item?.id).toBe('chat-1');
    expect(item?.otherParticipantUid).toBe('peer-b');
    expect(item?.otherParticipantIdentity).toBeNull();
    expect(item?.otherParticipantPreview).toBeNull();

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(error, {
      feature: 'direct-chat',
      operation: 'DirectChatFacade.enrichListItemsWithPublicProfiles$',
      fallbackMessage:
        'Não foi possível concluir uma operação interna do chat direto.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'DirectChatFacade',
        context: 'DirectChatFacade.enrichListItemsWithPublicProfiles$',
      },
    });

    subscription.unsubscribe();
  });

  it('mantém openChatWithUser$ fail-safe e silencioso', async () => {
    const uidSubject = new BehaviorSubject<string | null>('user-a');
    const error = new Error('ensure failed');
    const applicationError = buildApplicationError();

    const directChatService = {
      getMyDirectChats$: () => of([] as IChat[]),
      ensureDirectChatIdWithUser$: () => throwError(() => error),
    } as unknown as DirectChatService;

    const firestoreUserQuery = {
      getUsersPublicMap$: () => of({}),
    } as unknown as FirestoreUserQueryService;

    const facade = new DirectChatFacade(
      directChatService,
      buildAuthSession(uidSubject),
      firestoreUserQuery,
      applicationError.service,
      buildDestroyRef()
    );

    await expect(
      firstValueFrom(facade.openChatWithUser$('peer-b'))
    ).resolves.toBeNull();

    expect(applicationError.report).toHaveBeenCalledTimes(1);
    expect(applicationError.report).toHaveBeenCalledWith(error, {
      feature: 'direct-chat',
      operation: 'DirectChatFacade.openChatWithUser$',
      fallbackMessage:
        'Não foi possível concluir uma operação interna do chat direto.',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'DirectChatFacade',
        context: 'DirectChatFacade.openChatWithUser$',
      },
    });
  });

  it('não quebra fallback se a própria camada de diagnóstico falhar', () => {
    const uidSubject = new BehaviorSubject<string | null>('user-a');
    const applicationError = buildApplicationError();
    applicationError.report.mockImplementation(() => {
      throw new Error('diagnostic unavailable');
    });

    const directChatService = {
      getMyDirectChats$: () => throwError(() => new Error('listener failed')),
      ensureDirectChatIdWithUser$: () => of(null),
    } as unknown as DirectChatService;

    const firestoreUserQuery = {
      getUsersPublicMap$: () => of({}),
    } as unknown as FirestoreUserQueryService;

    const facade = new DirectChatFacade(
      directChatService,
      buildAuthSession(uidSubject),
      firestoreUserQuery,
      applicationError.service,
      buildDestroyRef()
    );

    const emissions: IChat[][] = [];
    expect(() => {
      const subscription = facade.chats$.subscribe((items) => {
        emissions.push(items);
      });
      subscription.unsubscribe();
    }).not.toThrow();

    expect(last(emissions)).toEqual([]);
  });
});
