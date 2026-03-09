// src/app/chat-module/room-interaction/room-interaction.component.ts
// Componente de interação da sala
// Ajustes principais:
// usa AuthSessionService + CurrentUserStoreService
// - Observa roomId de forma reativa via Signal Input
// - Cancela streams antigos ao trocar de sala
// - Mantém nomenclaturas públicas do componente
// - Centraliza erros e evita subscribe legado desnecessário

import {
  Component,
  Input,
  OnInit,
  ViewChild,
  ElementRef,
  input,
  inject,
  DestroyRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Timestamp } from '@firebase/firestore';
import { combineLatest, forkJoin, Observable, of, throwError } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  switchMap,
  take,
  tap,
} from 'rxjs/operators';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { RoomParticipantsService } from 'src/app/core/services/batepapo/room-services/room-participants.service';
import { RoomMessagesService } from 'src/app/core/services/batepapo/room-services/room-messages.service';
import { RoomService } from 'src/app/core/services/batepapo/room-services/room.service';

import { FirestoreQueryService } from 'src/app/core/services/data-handling/firestore-query.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';

type RoomParticipantVm = {
  uid: string;
  nickname: string;
  photoURL?: string;
  isCreator?: boolean;
  isOnline?: boolean;
  gender?: string;
  municipio?: string;
};

@Component({
  selector: 'app-room-interaction',
  templateUrl: './room-interaction.component.html',
  styleUrls: ['./room-interaction.component.css'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomInteractionComponent implements OnInit {
  readonly roomId = input.required<string | undefined>();

  @Input() roomName?: string;

  @ViewChild('messagesContainerRef', { static: false })
  private messagesContainer?: ElementRef<HTMLElement>;

  participants: RoomParticipantVm[] = [];
  creatorDetails: IUserDados | null = null;
  messages: Message[] = [];
  messageContent = '';
  currentUser: { uid: string; nickname: string } | null = null;

  private readonly destroyRef = inject(DestroyRef);

  private rawParticipants: RoomParticipantVm[] = [];

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly currentUserStore: CurrentUserStoreService,
    private readonly roomParticipants: RoomParticipantsService,
    private readonly roomMessages: RoomMessagesService,
    private readonly roomService: RoomService,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly firestoreQuery: FirestoreQueryService,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  /**
   * roomId reativo:
   * - normaliza
   * - ignora vazio
   * - evita reprocessar o mesmo valor
   */
  private readonly roomId$ = toObservable(this.roomId).pipe(
    map((roomId) => (roomId ?? '').trim()),
    filter((roomId): roomId is string => !!roomId),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /**
   * Usuário atual canônico do componente:
   * - uid vem do AuthSessionService
   * - nickname vem do CurrentUserStoreService
   */
  private readonly currentUser$ = combineLatest([
    this.authSession.uid$,
    this.currentUserStore.user$,
  ]).pipe(
    map(([uid, appUser]) => {
      const normalizedUid = (uid ?? '').trim();
      if (!normalizedUid) return null;

      return {
        uid: normalizedUid,
        nickname:
          (appUser && appUser !== null && appUser !== undefined
            ? (appUser.nickname ?? '').trim()
            : '') || 'Usuário não identificado',
      };
    }),
    distinctUntilChanged(
      (a, b) => (a?.uid ?? null) === (b?.uid ?? null) && (a?.nickname ?? null) === (b?.nickname ?? null)
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  ngOnInit(): void {
    this.observeCurrentUser();
    this.loadRoomName();
    this.loadMessages();
    this.loadParticipants();
    this.loadRoomCreator();
  }

  // ===========================================================================
  // Usuário atual
  // ===========================================================================

  private observeCurrentUser(): void {
    this.currentUser$
      .pipe(
        tap((user) => {
          this.currentUser = user;
        }),
        catchError((err) => {
          this.reportError(
            'Falha ao observar usuário autenticado.',
            err,
            { op: 'observeCurrentUser' },
            false
          );
          this.currentUser = null;
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  // ===========================================================================
  // Sala
  // ===========================================================================

  private loadRoomName(): void {
    this.roomId$
      .pipe(
        switchMap((roomId) =>
          this.roomService.getRoomById(roomId).pipe(
            tap((room) => {
              this.roomName = room?.roomName || 'Sala de Bate-papo';
            }),
            catchError((err) => {
              this.reportError(
                'Erro ao carregar informações da sala.',
                err,
                { op: 'loadRoomName', roomId }
              );
              this.roomName = 'Sala de Bate-papo';
              return of(null);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  // ===========================================================================
  // Mensagens
  // ===========================================================================

  private loadMessages(): void {
    this.roomId$
      .pipe(
        switchMap((roomId) =>
          this.roomMessages.getRoomMessages(roomId).pipe(
            switchMap((messages) => this.enrichMessagesWithNicknames$(messages)),
            switchMap((messages) =>
              this.currentUser$.pipe(
                take(1),
                switchMap((currentUser) =>
                  this.markMessagesAsReadIfNeeded$(roomId, currentUser?.uid ?? null, messages).pipe(
                    map(() => messages)
                  )
                )
              )
            ),
            tap((messages) => {
              this.messages = messages;
              this.scrollToBottom();
            }),
            catchError((err) => {
              this.reportError(
                'Erro ao carregar mensagens.',
                err,
                { op: 'loadMessages', roomId }
              );
              this.messages = [];
              return of([] as Message[]);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private enrichMessagesWithNicknames$(messages: Message[]): Observable<Message[]> {
    if (!messages?.length) {
      return of([]);
    }

    const uniqueSenderIds = Array.from(
      new Set(
        messages
          .map((msg) => (msg.senderId ?? '').trim())
          .filter((uid): uid is string => !!uid)
      )
    );

    if (!uniqueSenderIds.length) {
      return of(messages);
    }

    const lookups: Record<string, Observable<IUserDados | null>> = {};

    for (const uid of uniqueSenderIds) {
      lookups[uid] = this.resolveUserByUid$(uid);
    }

    return forkJoin(lookups).pipe(
      map((usersMap) =>
        messages.map((msg) => ({
          ...msg,
          nickname:
            usersMap[msg.senderId]?.nickname ||
            msg.nickname ||
            `Usuário não encontrado (${msg.senderId})`,
        }))
      ),
      catchError((err) => {
        this.reportError(
          'Falha ao enriquecer mensagens com apelidos.',
          err,
          { op: 'enrichMessagesWithNicknames' },
          false
        );
        return of(messages);
      })
    );
  }

  private resolveUserByUid$(uid: string): Observable<IUserDados | null> {
    const normalizedUid = (uid ?? '').trim();
    if (!normalizedUid) {
      return of(null);
    }

    return this.firestoreQuery.getUserFromState(normalizedUid).pipe(
      take(1),
      catchError((err) => {
        this.reportError(
          'Falha ao consultar usuário no state.',
          err,
          { op: 'resolveUserByUid.state', uid: normalizedUid },
          false
        );
        return of(null);
      }),
      switchMap((userFromState) => {
        if (userFromState) {
          return of(userFromState);
        }

        return this.firestoreUserQuery.getUser(normalizedUid).pipe(
          take(1),
          catchError((err) => {
            this.reportError(
              'Falha ao consultar usuário no Firestore.',
              err,
              { op: 'resolveUserByUid.firestore', uid: normalizedUid },
              false
            );
            return of(null);
          })
        );
      })
    );
  }

  private markMessagesAsReadIfNeeded$(
    roomId: string,
    myUid: string | null,
    messages: Message[]
  ): Observable<number> {
    const rid = (roomId ?? '').trim();
    const uid = (myUid ?? '').trim();

    if (!rid || !uid || !messages?.length) {
      return of(0);
    }

    return this.roomMessages.markDeliveredAsRead$(rid, uid, messages).pipe(
      catchError((err) => {
        this.reportError(
          'Falha ao marcar mensagens como lidas.',
          err,
          { op: 'markMessagesAsReadIfNeeded', roomId: rid, myUid: uid },
          false
        );
        return of(0);
      })
    );
  }

  private scrollToBottom(): void {
    if (!this.messagesContainer?.nativeElement) {
      return;
    }

    try {
      requestAnimationFrame(() => {
        const el = this.messagesContainer?.nativeElement;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
      });
    } catch (err) {
      this.reportError(
        'Erro ao rolar para a última mensagem.',
        err,
        { op: 'scrollToBottom' },
        false
      );
    }
  }

  // ===========================================================================
  // Participantes
  // ===========================================================================

  openParticipantOptions(participant: RoomParticipantVm): void {
    console.log('Opções para o participante:', participant);
  }

  private loadParticipants(): void {
    this.roomId$
      .pipe(
        switchMap((roomId) =>
          this.roomParticipants.getParticipants(roomId).pipe(
            tap((participants) => {
              this.rawParticipants = (participants ?? []).map((participant: any) => ({
                uid: participant?.uid || participant?.id || '',
                nickname: participant?.nickname || 'Participante',
                photoURL: participant?.photoURL,
                isCreator: !!participant?.isCreator,
                isOnline: participant?.isOnline,
                gender: participant?.gender,
                municipio: participant?.municipio,
              }));
              this.syncParticipantsView();
            }),
            catchError((err) => {
              this.reportError(
                'Erro ao carregar participantes.',
                err,
                { op: 'loadParticipants', roomId }
              );
              this.rawParticipants = [];
              this.syncParticipantsView();
              return of([]);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private loadRoomCreator(): void {
    this.roomId$
      .pipe(
        switchMap((roomId) =>
          this.roomParticipants.getRoomCreator(roomId).pipe(
            tap((creator) => {
              this.creatorDetails = creator;
              this.syncParticipantsView();
            }),
            catchError((err) => {
              this.reportError(
                'Erro ao carregar informações do criador da sala.',
                err,
                { op: 'loadRoomCreator', roomId }
              );
              this.creatorDetails = null;
              this.syncParticipantsView();
              return of(null);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  private syncParticipantsView(): void {
    const normalizedParticipants = (this.rawParticipants ?? []).filter((p) => !!p.uid);

    if (!this.creatorDetails?.uid) {
      this.participants = normalizedParticipants;
      return;
    }

    const creatorUid = this.creatorDetails.uid;
    const creatorIndex = normalizedParticipants.findIndex((p) => p.uid === creatorUid);

    if (creatorIndex >= 0) {
      const creatorFromList = normalizedParticipants[creatorIndex];

      const mergedCreator: RoomParticipantVm = {
        ...creatorFromList,
        uid: creatorUid,
        nickname: this.creatorDetails.nickname || creatorFromList.nickname || 'Criador',
        photoURL:
          this.creatorDetails.photoURL ||
          creatorFromList.photoURL ||
          'assets/default-avatar.png',
        isCreator: true,
        isOnline: this.creatorDetails.isOnline ?? creatorFromList.isOnline,
        gender: this.creatorDetails.gender ?? creatorFromList.gender,
        municipio: this.creatorDetails.municipio ?? creatorFromList.municipio,
      };

      this.participants = [
        mergedCreator,
        ...normalizedParticipants.filter((p) => p.uid !== creatorUid),
      ];
      return;
    }

    this.participants = [
      {
        uid: creatorUid,
        nickname: this.creatorDetails.nickname || 'Criador',
        photoURL: this.creatorDetails.photoURL || 'assets/default-avatar.png',
        isCreator: true,
        isOnline: this.creatorDetails.isOnline,
        gender: this.creatorDetails.gender,
        municipio: this.creatorDetails.municipio,
      },
      ...normalizedParticipants,
    ];
  }

  // ===========================================================================
  // Envio
  // ===========================================================================

  sendMessage(): void {
    const content = this.messageContent.trim();
    const roomId = (this.roomId() ?? '').trim();

    if (!content) {
      this.errorNotifier.showWarning('Mensagem vazia. Não será enviada.');
      return;
    }

    if (!roomId) {
      this.errorNotifier.showError('Erro: ID da sala não definido.');
      return;
    }

    this.currentUser$
      .pipe(
        take(1),
        switchMap((currentUser) => {
          if (!currentUser?.uid) {
            return throwError(() => new Error('Usuário não autenticado encontrado.'));
          }

          const newMessage: Message = {
            content,
            senderId: currentUser.uid,
            nickname: currentUser.nickname || 'Usuário não identificado',
            timestamp: Timestamp.fromDate(new Date()),
          };

          return this.roomMessages.sendMessageToRoom$(roomId, newMessage);
        }),
        catchError((err) => {
          this.reportError(
            'Erro ao enviar mensagem.',
            err,
            { op: 'sendMessage', roomId }
          );
          return of('');
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((messageId) => {
        if (!messageId) {
          return;
        }

        this.messageContent = '';
        this.scrollToBottom();
      });
  }

  // ===========================================================================
  // Error handling
  // ===========================================================================

  private reportError(
    userMessage: string,
    err: unknown,
    context?: Record<string, unknown>,
    notifyUser = true
  ): void {
    if (notifyUser) {
      try {
        this.errorNotifier.showError(userMessage);
      } catch {
        // noop
      }
    }

    try {
      const error = err instanceof Error ? err : new Error(userMessage);
      (error as any).original = err;
      (error as any).context = {
        scope: 'RoomInteractionComponent',
        ...(context ?? {}),
      };
      (error as any).skipUserNotification = true;
      this.globalError.handleError(error);
    } catch {
      // noop
    }
  }
} // Linha 571, fim do RoomInteractionComponent
