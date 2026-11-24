// src/app/core/services/data-handling/firestore/repositories/chat.repository.ts
import { Injectable, inject } from '@angular/core';
import { Observable, defer, of, throwError } from 'rxjs';
import { filter, map, switchMap, take } from 'rxjs/operators';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { createChatDiscoveryScope$, type ChatDiscoveryScope } from './chat-discovery-scope';
import { recoverDirectChatListener$ } from 'src/app/messaging/direct-chat/services/direct-chat-listener-recovery';

import {
  Firestore,
  collection,
  query,
  where,
} from '@angular/fire/firestore';

import { Timestamp, onSnapshot } from 'firebase/firestore';

import { IChat } from '@core/interfaces/interfaces-chat/chat.interface';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';

@Injectable({ providedIn: 'root' })
export class ChatRepository {
  private readonly db = inject(Firestore);
  private readonly ctx = inject(FirestoreContextService);
  private readonly access = inject(AccessControlService);
  private readonly applicationError = inject(ApplicationErrorService);

  readonly discoveryScope$ = createChatDiscoveryScope$(
    this.access.authUid$,
    this.access.canRunChatRealtime$,
    uid => recoverDirectChatListener$<ChatDiscoveryScope>(
      () => this.observeTransport$(uid),
      error => this.failedScope(uid, error)
    ),
    (uid, error) => this.failedScope(uid, error)
  );

  private failedScope(uid: string, error: unknown): ChatDiscoveryScope {
    this.applicationError.report(error, {
      feature: 'chat',
      operation: 'ChatRepository.discoveryScope$',
      fallbackMessage: 'Não foi possível acompanhar conversas.',
      presentation: { surface: 'none', severity: 'error' },
    });
    return { ownerUid: uid, status: 'error', chats: [] };
  }

  // R1.5 replaces this transport. Never authorize from candidates or cache.
  private observeTransport$(uid: string): Observable<ChatDiscoveryScope> {
    return this.ctx.deferObservable$(() => {
      const q = query(collection(this.db, 'chats'), where('participants', 'array-contains', uid));
      return new Observable<ChatDiscoveryScope>(sink => onSnapshot(q, { includeMetadataChanges: true }, snapshot => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
          sink.next({ ownerUid: uid, status: 'loading', chats: [] });
          return;
        }
        sink.next({
          ownerUid: uid, status: 'ready',
          chats: snapshot.docs.map(d => ({ ...d.data(), id: d.id } as IChat)),
        });
      }, error => sink.error(error)));
    });
  }

  /**
   * Criação, alteração e exclusão estrutural de chats são exclusivas do
   * backend. A consulta por participantsKey também é backend-only porque
   * não pode ser autorizada como uma leitura de coleção de participantes.
   * A UI moderna utiliza DirectChatService.ensureDirectChatIdWithUser$.
   *
   * Assinaturas mantidas apenas para consumidores legados. Nunca retorne
   * valores vazios ou void como se a escrita tivesse sido confirmada.
   */
  private rejectLegacyChatOperation$<T>(operation: string): Observable<T> {
    return defer(() => {
      const error = new Error(
        'Operação de conversa direta descontinuada. Use ensureDirectChat no backend.'
      ) as Error & { code: string; operation: string };
      error.code = 'failed-precondition';
      error.operation = operation;
      return throwError(() => error);
    });
  }

  findChatIdByParticipantsKey$(_participantsKey: string): Observable<string | null> {
    return this.rejectLegacyChatOperation$('findChatIdByParticipantsKey$');
  }

  createChat$(_participants: string[], _participantsKey: string): Observable<string> {
    return this.rejectLegacyChatOperation$('createChat$');
  }

  updateChat$(_chatId: string, _patch: Partial<IChat>): Observable<void> {
    return this.rejectLegacyChatOperation$('updateChat$');
  }

  deleteChat$(_chatId: string): Observable<void> {
    return this.rejectLegacyChatOperation$('deleteChat$');
  }

  watchChats$(uid: string, pageSize = 10): Observable<IChat[]> {
    return this.watchDiscoveryForOwner$(uid).pipe(map(scope => scope.chats.slice(0, pageSize)));
  }

  watchDiscoveryForOwner$(uid: string): Observable<ChatDiscoveryScope> {
    const owner = String(uid ?? '').trim();
    return this.discoveryScope$.pipe(map(scope => owner && scope.ownerUid === owner
      ? scope
      : { ownerUid: null, status: 'revoked', chats: [] }));
  }

  getChatsPageOnce$(uid: string, lastChatTimestamp?: Timestamp, pageSize = 10): Observable<IChat[]> {
    return this.watchDiscoveryForOwner$(uid).pipe(
      filter(scope => scope.status !== 'loading'),
      take(1),
      switchMap(scope => scope.status === 'error'
        ? throwError(() => new Error('Não foi possível consultar conversas.'))
        : of(scope.chats.filter(chat => !lastChatTimestamp ||
          chat.timestamp.seconds < lastChatTimestamp.seconds ||
          (chat.timestamp.seconds === lastChatTimestamp.seconds &&
            chat.timestamp.nanoseconds < lastChatTimestamp.nanoseconds)).slice(0, pageSize)))
    );
  }
}
