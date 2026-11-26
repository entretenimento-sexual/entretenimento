// src/app/messaging/direct-chat/application/direct-chat.facade.ts
// ============================================================================
// DIRECT CHAT FACADE
//
// Responsabilidade desta facade:
// - expor a lista reativa de chats diretos 1:1
// - manter a seleção atual do chat direto
// - resolver a abertura de chat por participant uid
// - derivar item selecionado / estado da lista
//
// Isolamento de sessão:
// - toda coleção transporta o UID e a versão da sessão proprietária;
// - cada troca de sessão começa com lista vazia antes do novo listener;
// - a seleção não reaparece após troca de UID nem após novo login no mesmo UID.
// ============================================================================
import { DestroyRef, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, combineLatest, defer, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  takeUntil,
  filter,
  tap,
} from 'rxjs/operators';

import { normalizePublicUserIdentity } from '@core/domain/public-user-identity/public-user-identity.model';
import { normalizePublicUserPreview } from '@core/domain/public-user-preview/public-user-preview.model';
import { IChat } from '@core/interfaces/interfaces-chat/chat.interface';
import { UserPublic } from '@core/interfaces/user-public.interface';
import {
  DirectChatListItem,
  DirectChatListState,
  DirectChatInboxState,
} from '../models/direct-chat.models';

import { ChatNotificationService } from '@core/services/batepapo/chat-notification.service';
import { DirectChatService } from '../services/direct-chat.service';
import { DirectChatAvailabilityService } from '../services/direct-chat-availability.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { FirestoreUserQueryService } from '@core/services/data-handling/firestore-user-query.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';

interface DirectChatSessionIdentity {
  uid: string | null;
  epoch: number;
}

interface DirectChatSessionScope extends DirectChatSessionIdentity {
  chats: IChat[];
}

interface DirectChatSelectionRequest {
  ownerUid: string | null;
  sessionEpoch: number;
  chatId: string | null;
}

@Injectable({ providedIn: 'root' })
export class DirectChatFacade {
  private readonly sessionIdentitySubject =
    new BehaviorSubject<DirectChatSessionIdentity>({
      uid: null,
      epoch: 0,
    });

  private readonly selectedChatRequestSubject =
    new BehaviorSubject<DirectChatSelectionRequest>({
      ownerUid: null,
      sessionEpoch: 0,
      chatId: null,
    });

  private readonly sessionIdentity$ =
    this.sessionIdentitySubject.asObservable().pipe(
      distinctUntilChanged(
        (previous, current) =>
          previous.uid === current.uid && previous.epoch === current.epoch
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  /**
   * Escopo canônico da lista.
   *
   * `startWith([])` é intencional: na troca de sessão a UI limpa imediatamente
   * a projeção anterior antes de qualquer snapshot da nova identidade.
   */
  private readonly sessionChats$: Observable<DirectChatSessionScope> =
    this.sessionIdentity$.pipe(
      switchMap(({ uid, epoch }) => {
        if (!uid) {
          return of({ uid: null, epoch, chats: [] });
        }

        return this.directChatService.getMyDirectChatScope$().pipe(
          map((scope) => ({
            uid,
            epoch,
            chats: scope.ownerUid === uid && Array.isArray(scope.chats) ? scope.chats : [],
          })),
          startWith({ uid, epoch, chats: [] }),
          catchError((error) => {
            this.reportSilent(error, 'DirectChatFacade.sessionChats$');
            return of({ uid, epoch, chats: [] });
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly requestedSelectedChatId$ = combineLatest([
    this.selectedChatRequestSubject.asObservable(),
    this.sessionIdentity$,
  ]).pipe(
    map(([request, session]) => {
      if (!request.chatId || !session.uid) return null;

      return request.ownerUid === session.uid &&
        request.sessionEpoch === session.epoch
        ? request.chatId
        : null;
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly chats$: Observable<IChat[]> = this.sessionChats$.pipe(
    map(({ chats }) => chats),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly items$: Observable<DirectChatListItem[]> = this.sessionIdentity$.pipe(
    switchMap(({ uid, epoch }) => {
      if (!uid) return of([] as DirectChatListItem[]);

      const scopedItems$ = this.sessionChats$.pipe(
        filter((scope) => scope.uid === uid && scope.epoch === epoch),
        map(({ chats }) => chats
          .map((chat) => this.toListItem(chat, uid))
          .filter((item) => !!item.id)),
        shareReplay({ bufferSize: 1, refCount: true })
      );

      // Uma mudança no preview/unread não altera os UIDs a consultar.
      const publicProfiles$ = scopedItems$.pipe(
        map((items) => Array.from(new Set(items
          .map((item) => String(item.otherParticipantUid ?? '').trim())
          .filter(Boolean))).sort()),
        distinctUntilChanged((a, b) =>
          a.length === b.length && a.every((uid, i) => uid === b[i])),
        switchMap((uids) => {
          if (!uids.length) return of({} as Record<string, UserPublic>);
          return this.firestoreUserQuery.getUsersPublicMap$(uids).pipe(
            catchError((error) => {
              this.reportSilent(error, 'DirectChatFacade.enrichListItemsWithPublicProfiles$');
              return of({} as Record<string, UserPublic>);
            })
          );
        })
      );

      return combineLatest([scopedItems$, publicProfiles$, this.chatNotification.unreadState$]).pipe(
        map(([items, profiles, unread]) => this.applyPublicProfiles(items, profiles).map(item => ({
          ...item, unreadCount: unread.ownerUid === uid ? unread.counts.get(item.id) ?? 0 : 0,
        })))
      );
    }),
    catchError((error) => {
      this.reportSilent(error, 'DirectChatFacade.items$');
      return of([] as DirectChatListItem[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  observeProgressiveInbox$(
    loadMore$: Observable<unknown>, refresh$: Observable<unknown>
  ): Observable<DirectChatInboxState> {
    const empty: DirectChatInboxState = {
      items: [], status: 'revoked', hasMore: false, unconfirmedCount: 0, directUnreadCount: 0,
    };
    return this.sessionIdentity$.pipe(
      switchMap(({ uid }) => {
        if (!uid) return of(empty);
        const scoped$ = defer(() => this.directChatService.observeDirectChatInboxForOwner$(uid, loadMore$, refresh$))
          .pipe(shareReplay({ bufferSize: 1, refCount: true }));
        const items$ = scoped$.pipe(
          map(scope => scope.ownerUid === uid ? scope.chats
            .filter(chat => !!chat.id && !!this.canonicalPeer(chat, uid, chat.id))
            .map(chat => this.toListItem(chat, uid)) : []),
          shareReplay({ bufferSize: 1, refCount: true })
        );
        const profiles$ = items$.pipe(
          map(items => [...new Set(items.map(item => item.otherParticipantUid)
            .filter((peer): peer is string => !!peer))].sort()),
          distinctUntilChanged((a, b) => a.length === b.length && a.every((value, i) => value === b[i])),
          switchMap(uids => uids.length
            ? this.firestoreUserQuery.getUsersPublicMap$(uids).pipe(
              startWith({} as Record<string, UserPublic>),
              catchError(error => {
                this.reportSilent(error, 'DirectChatFacade.observeProgressiveInbox$.profiles');
                return of({} as Record<string, UserPublic>);
              })
            ) : of({} as Record<string, UserPublic>))
        );
        return combineLatest([scoped$, profiles$, this.chatNotification.unreadState$]).pipe(
          map(([scope, profiles, unread]): DirectChatInboxState => {
            if (scope.ownerUid !== uid) return empty;
            const counts = unread.ownerUid === uid ? unread.counts : new Map<string, number>();
            // Derive items from the same scope, never from a lagging separate list.
            const items = scope.chats.filter(chat => !!chat.id && !!this.canonicalPeer(chat, uid, chat.id))
              .map(chat => this.toListItem(chat, uid));
            return {
              items: this.applyPublicProfiles(items, profiles).map(item => ({
                ...item, unreadCount: counts.get(item.id) ?? 0,
              })),
              status: scope.status, hasMore: scope.hasMore,
              unconfirmedCount: scope.unconfirmedCount,
              directUnreadCount: [...counts.values()].reduce((total, count) => total + count, 0),
            };
          }),
          startWith({ ...empty, status: 'loading' as const }),
          catchError(error => {
            this.reportSilent(error, 'DirectChatFacade.observeProgressiveInbox$');
            return of({ ...empty, status: 'error' as const });
          })
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private readonly selectedCanonicalScope$ = combineLatest([
    this.sessionIdentity$, this.selectedChatRequestSubject,
  ]).pipe(
    map(([session, request]) => session.uid && request.ownerUid === session.uid &&
      request.sessionEpoch === session.epoch && request.chatId
      ? { owner: session.uid, epoch: session.epoch, chatId: request.chatId } : null),
    distinctUntilChanged((a,b) => a === b || (!!a && !!b &&
      a.owner === b.owner && a.epoch === b.epoch && a.chatId === b.chatId)),
    switchMap(context => context ? defer(() =>
      this.directChatService.observeDirectChatForOwner$(context.owner, context.chatId)
    ).pipe(
      map(chat => {
        const peer = this.canonicalPeer(chat, context.owner, context.chatId);
        return chat && peer ? { ...context, peer, chat } : null;
      }),
      startWith(null),
      catchError(error => {
        this.reportSilent(error, 'DirectChatFacade.selectedCanonicalScope$');
        return of(null);
      })
    ) : of(null)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedChatId$: Observable<string | null> = this.selectedCanonicalScope$.pipe(
    map(scope => scope?.chatId ?? null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedChat$: Observable<IChat | null> = this.selectedCanonicalScope$.pipe(
    map(scope => scope?.chat ?? null),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedChatAccess$: Observable<{
    owner: string; epoch: number; chatId: string; peer: string; available: boolean; readable: boolean;
  } | null> = this.selectedCanonicalScope$.pipe(
    map(scope => scope ? { owner: scope.owner, epoch: scope.epoch, chatId: scope.chatId, peer: scope.peer } : null),
    distinctUntilChanged((a, b) => a === b || (!!a && !!b &&
      a.owner === b.owner && a.epoch === b.epoch && a.chatId === b.chatId && a.peer === b.peer)),
    switchMap(context => context ? this.availabilityService.observeForCurrentUser$(context.peer, context.owner).pipe(
      startWith(false),
      catchError(error => {
        this.reportSilent(error, 'DirectChatFacade.selectedChatCanOpen$');
        return of(false);
      }),
      map(available => ({ ...context, available, readable: true }))
    ) : of(null)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedChatCanOpen$: Observable<boolean> = this.selectedChatAccess$.pipe(
    map(access => access?.readable === true),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly state$: Observable<DirectChatListState> = combineLatest([
    this.items$,
    this.selectedChatId$,
  ]).pipe(
    map(([items, selectedChatId]) => ({
      items,
      selectedChatId,
      loading: false,
      loaded: true,
      errorMessage: null,
    })),
    catchError((error) => {
      this.reportSilent(error, 'DirectChatFacade.state$');
      return of({
        items: [],
        selectedChatId: null,
        loading: false,
        loaded: false,
        errorMessage: 'Não foi possível carregar os chats diretos.',
      } as DirectChatListState);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly directChatService: DirectChatService,
    private readonly authSession: AuthSessionService,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly applicationError: ApplicationErrorService,
    destroyRef: DestroyRef,
    private readonly availabilityService: DirectChatAvailabilityService,
    private readonly chatNotification: ChatNotificationService
  ) {
    this.authSession.uid$
      .pipe(
        map((uid) => String(uid ?? '').trim() || null),
        distinctUntilChanged(),
        takeUntilDestroyed(destroyRef)
      )
      .subscribe((uid) => {
        const epoch = this.sessionIdentitySubject.value.epoch + 1;
        const identity = { uid, epoch };

        this.sessionIdentitySubject.next(identity);
        this.selectedChatRequestSubject.next({
          ownerUid: uid,
          sessionEpoch: epoch,
          chatId: null,
        });
      });
  }

  /** Non-selected conversations (e.g. media sharing) require their own
   * canonical read scope and bilateral SEND permission. Never change selection. */
  observeCanSendToChat$(chatId: string): Observable<boolean> {
    // Capture the intent at creation, not at subscription. A cold observable
    // from a previous login must not acquire the new session's permission.
    const session = this.sessionIdentitySubject.value;
    const id = String(chatId ?? '').trim();
    return defer(() => {
      if (!session.uid || !id || this.sessionIdentitySubject.value !== session) return of(false);
      const owner = session.uid;
      return this.sessionIdentity$.pipe(
        switchMap(current => current === session
          ? defer(() => this.directChatService.observeDirectChatForOwner$(owner, id)).pipe(
            map(chat => this.canonicalPeer(chat, owner, id)), startWith(null)
          ) : of(null)),
        distinctUntilChanged(),
        switchMap(peer => peer
          ? this.availabilityService.observeForCurrentUser$(peer, owner).pipe(startWith(false))
          : of(false)),
        distinctUntilChanged(),
        catchError(error => {
          this.reportSilent(error, 'DirectChatFacade.observeCanSendToChat$');
          return of(false);
        })
      );
    });
  }

  private canonicalPeer(chat: IChat | null, owner: string, id: string): string | null {
    if (!chat || chat.id !== id || chat.isRoom || !Array.isArray(chat.participants)) return null;
    const pair = chat.participants;
    if (pair.length !== 2 || pair[0] === pair[1] || !pair.includes(owner) ||
        pair.some(uid => typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid))) return null;
    const data = chat as IChat & { conversationType?: unknown; conversationStatus?: unknown };
    const kind = String(data.conversationType ?? '').trim().toLowerCase();
    const status = String(data.conversationStatus ?? '').trim().toLowerCase();
    if ((kind && kind !== 'direct') || (status && status !== 'active')) return null;
    return pair.find(uid => uid !== owner) ?? null;
  }

  selectChat(chatId: string | null | undefined): void {
    const safeChatId = String(chatId ?? '').trim() || null;
    const session = this.sessionIdentitySubject.value;

    this.selectedChatRequestSubject.next({
      ownerUid: session.uid,
      sessionEpoch: session.epoch,
      chatId: safeChatId && session.uid ? safeChatId : null,
    });
  }

  /**
   * Recebe UID do outro perfil, resolve/cria a conversa e seleciona o chat real.
   */
  openChatWithUser$(otherUserUid: string): Observable<string | null> {
    const session = this.sessionIdentitySubject.value;
    if (!session.uid) return of(null);

    return this.directChatService.ensureDirectChatIdWithUser$(otherUserUid).pipe(
      takeUntil(this.sessionIdentity$.pipe(
        filter((current) =>
          current.uid !== session.uid || current.epoch !== session.epoch
        )
      )),
      tap((chatId) => {
        if (chatId) {
          this.selectChat(chatId);
        }
      }),
      catchError((error) => {
        this.reportSilent(error, 'DirectChatFacade.openChatWithUser$');
        return of(null);
      }),
      take(1)
    );
  }

  clearSelection(): void {
    const session = this.sessionIdentitySubject.value;

    this.selectedChatRequestSubject.next({
      ownerUid: session.uid,
      sessionEpoch: session.epoch,
      chatId: null,
    });
  }

  /**
   * Resolve somente informações públicas necessárias à apresentação da lista.
   *
   * Segurança:
   * - não consulta o documento privado /users do participante;
   * - não grava snapshot do perfil dentro do documento de chat;
   * - mantém fallback somente de leitura para conversas legadas já existentes;
   * - normaliza identidade e prévia pelo contrato universal do perfil público;
   * - UID localiza o participante, mas nunca substitui o profileId público.
   */
  private applyPublicProfiles(
    items: DirectChatListItem[],
    publicProfiles: Record<string, UserPublic>
  ): DirectChatListItem[] {
    return items.map((item) => {
      const participantUid = String(item.otherParticipantUid ?? '').trim();
      const publicProfile = participantUid ? publicProfiles[participantUid] : undefined;
      const preview = publicProfile ? normalizePublicUserPreview(publicProfile) : null;
      const identity = preview?.identity ??
        (publicProfile ? normalizePublicUserIdentity(publicProfile) : null);
      return {
        ...item,
        otherParticipantIdentity: identity,
        otherParticipantPreview: preview,
        otherParticipantNickname: identity?.nickname ?? null,
        otherParticipantPhotoURL: identity?.avatarUrl ?? null,
      };
    });
  }

  private toListItem(
    chat: IChat,
    currentUid: string | null
  ): DirectChatListItem {
    const safeCurrentUid = String(currentUid ?? '').trim() || null;

    const otherParticipantUid =
      (chat?.participants ?? []).find(
        (uid: string) => uid !== safeCurrentUid
      ) ?? null;

    const lastMessagePreview =
      (chat?.lastMessage?.content ?? '').trim() || null;

    return {
      id: (chat?.id ?? '').trim(),
      chat,
      otherParticipantUid,
      otherParticipantIdentity: null,
      otherParticipantPreview: null,
      otherParticipantNickname: null,
      otherParticipantPhotoURL: null,
      unreadCount: 0,
      lastMessagePreview,
      lastMessageAt:
        chat?.lastMessage?.timestamp?.toDate?.()?.getTime?.() ?? null,
      canOpen: !!chat?.id,
      availability: 'open',
      blockedReason: null,
      compatibilityLabel: null,
      isDesiredProfileMatch: null,
    };
  }

  private reportSilent(error: unknown, context: string): void {
    try {
      this.applicationError.report(error, {
        feature: 'direct-chat',
        operation: context,
        fallbackMessage:
          'Não foi possível concluir uma operação interna do chat direto.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'DirectChatFacade',
          context,
        },
      });
    } catch {
      // Diagnóstico secundário nunca interrompe os fallbacks reativos da facade.
    }
  }
}
