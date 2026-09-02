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
import { BehaviorSubject, combineLatest, Observable, of } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';

import { normalizePublicUserIdentity } from 'src/app/core/domain/public-user-identity/public-user-identity.model';
import { normalizePublicUserPreview } from 'src/app/core/domain/public-user-preview/public-user-preview.model';
import { IChat } from 'src/app/core/interfaces/interfaces-chat/chat.interface';
import {
  DirectChatListItem,
  DirectChatListState,
} from '../models/direct-chat.models';

import { DirectChatService } from '../services/direct-chat.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { FirestoreUserQueryService } from '@core/services/data-handling/firestore-user-query.service';
import { GlobalErrorHandlerService } from '@core/services/error-handler/global-error-handler.service';

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

        return this.directChatService.getMyDirectChats$().pipe(
          map((chats) => ({
            uid,
            epoch,
            chats: Array.isArray(chats) ? chats : [],
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

  readonly items$: Observable<DirectChatListItem[]> = this.sessionChats$.pipe(
    switchMap(({ chats, uid }) => {
      if (!uid) {
        return of([] as DirectChatListItem[]);
      }

      const items = (chats ?? [])
        .map((chat) => this.toListItem(chat, uid))
        .filter((item) => !!item.id);

      return this.enrichListItemsWithPublicProfiles$(items);
    }),
    catchError((error) => {
      this.reportSilent(error, 'DirectChatFacade.items$');
      return of([] as DirectChatListItem[]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedChatId$: Observable<string | null> = combineLatest([
    this.chats$,
    this.requestedSelectedChatId$,
  ]).pipe(
    map(([chats, requestedId]) => {
      if (!requestedId) return null;

      const exists = (chats ?? []).some(
        (chat) => (chat?.id ?? '').trim() === requestedId
      );

      return exists ? requestedId : null;
    }),
    distinctUntilChanged(),
    catchError((error) => {
      this.reportSilent(error, 'DirectChatFacade.selectedChatId$');
      return of(null);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedChat$: Observable<IChat | null> = combineLatest([
    this.chats$,
    this.selectedChatId$,
  ]).pipe(
    map(([chats, selectedChatId]) => {
      if (!selectedChatId) return null;

      return (
        (chats ?? []).find(
          (chat) => (chat?.id ?? '').trim() === selectedChatId
        ) ?? null
      );
    }),
    catchError((error) => {
      this.reportSilent(error, 'DirectChatFacade.selectedChat$');
      return of(null);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly selectedChatCanOpen$: Observable<boolean> = this.selectedChat$.pipe(
    map((chat) => !!chat),
    distinctUntilChanged(),
    catchError((error) => {
      this.reportSilent(error, 'DirectChatFacade.selectedChatCanOpen$');
      return of(false);
    }),
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
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    destroyRef: DestroyRef
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
    return this.directChatService.ensureDirectChatIdWithUser$(otherUserUid).pipe(
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
  private enrichListItemsWithPublicProfiles$(
    items: DirectChatListItem[]
  ): Observable<DirectChatListItem[]> {
    const participantUids = Array.from(
      new Set(
        items
          .map((item) => String(item.otherParticipantUid ?? '').trim())
          .filter((uid) => uid.length > 0)
      )
    );

    if (!participantUids.length) {
      return of(items);
    }

    return this.firestoreUserQuery.getUsersPublicMap$(participantUids).pipe(
      map((publicProfiles) =>
        items.map((item) => {
          const participantUid = String(
            item.otherParticipantUid ?? ''
          ).trim();

          const publicProfile = participantUid
            ? publicProfiles[participantUid]
            : undefined;
          const preview = publicProfile
            ? normalizePublicUserPreview(publicProfile)
            : null;
          const identity = preview?.identity
            ?? (publicProfile
              ? normalizePublicUserIdentity(publicProfile)
              : null);

          return {
            ...item,
            otherParticipantIdentity: identity,
            otherParticipantPreview: preview,
            // Aliases legados permanecem derivados da mesma identidade, evitando
            // duas fontes de verdade durante a migração do Chat.
            otherParticipantNickname: identity?.nickname ?? null,
            otherParticipantPhotoURL: identity?.avatarUrl ?? null,
          };
        })
      ),
      catchError((error) => {
        this.reportSilent(
          error,
          'DirectChatFacade.enrichListItemsWithPublicProfiles$'
        );

        return of(items);
      })
    );
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
      unreadCount: Number((chat as any)?.unreadCount ?? 0),
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
      const err =
        error instanceof Error
          ? error
          : new Error('[DirectChatFacade] operation failed');

      (err as any).original = error;
      (err as any).context = context;
      (err as any).skipUserNotification = true;
      (err as any).silent = true;

      this.globalErrorHandler.handleError(err);
    } catch {
      // noop
    }
  }
}
