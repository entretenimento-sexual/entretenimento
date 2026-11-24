// src/app/core/services/data-handling/firestore/repositories/chat.repository.ts
import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, defer, of, throwError, timer } from 'rxjs';
import { catchError, distinctUntilChanged, exhaustMap, filter, map, startWith, switchMap, take } from 'rxjs/operators';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { createChatDiscoveryScope$, type ChatDiscoveryScope } from './chat-discovery-scope';
import { recoverDirectChatListener$ } from 'src/app/messaging/direct-chat/services/direct-chat-listener-recovery';

import {
  Firestore,
  doc,
} from '@angular/fire/firestore';

import { Timestamp, onSnapshot } from 'firebase/firestore';

import { IChat } from '@core/interfaces/interfaces-chat/chat.interface';
import { FirestoreContextService } from '@core/services/data-handling/firestore/core/firestore-context.service';

@Injectable({ providedIn: 'root' })
export class ChatRepository {
  private readonly db = inject(Firestore);
  private readonly functions = inject(Functions);
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

  // Only the backend discovers IDs. Each individual listener still uses Rules.
  private observeTransport$(uid: string): Observable<ChatDiscoveryScope> {
    return timer(0, 60_000).pipe(
      exhaustMap(() => this.ctx.deferPromise$(() =>
        httpsCallable<Record<string, never>, { chatIds: string[] }>(
          this.functions, 'listDirectChatCandidates'
        )({})).pipe(
        map(({ data }) => {
          if (!Array.isArray(data.chatIds) || data.chatIds.some(id =>
            typeof id !== 'string' || !id || id.includes('/'))) {
            throw new Error('Resposta de descoberta inválida.');
          }
          return { ids: [...new Set(data.chatIds)].sort(), failure: null as ChatDiscoveryScope | null };
        }),
        catchError(error => of({ ids: [] as string[], failure: this.failedScope(uid, error) }))
      )),
      distinctUntilChanged((a, b) => !a.failure && !b.failure &&
        a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i])),
      switchMap(({ ids, failure }) => {
        if (failure) return of(failure);
        if (!ids.length) return of({ ownerUid: uid, status: 'ready', chats: [] } as ChatDiscoveryScope);
        return combineLatest(ids.map(id => this.observeChat$(id))).pipe(
          map(chats => ({ ownerUid: uid, status: 'ready' as const,
            chats: chats.filter((chat): chat is IChat => chat !== null) }))
        );
      })
    );
  }

  private observeChat$(id: string): Observable<IChat | null> {
    return recoverDirectChatListener$<IChat | null>(() =>
      this.ctx.deferObservable$(() => {
        const ref = doc(this.db, 'chats', id);
        return new Observable<IChat | null>(sink => onSnapshot(ref,
          { includeMetadataChanges: true }, snapshot => {
            sink.next(snapshot.exists() && !snapshot.metadata.fromCache &&
              !snapshot.metadata.hasPendingWrites
              ? { ...snapshot.data(), id: snapshot.id } as IChat : null);
          }, error => sink.error(error)));
      }), () => null
    ).pipe(catchError((error): Observable<IChat | null> => {
      this.applicationError.report(error, {
        feature: 'chat', operation: 'ChatRepository.observeChat$',
        fallbackMessage: 'Não foi possível acompanhar uma conversa.',
        presentation: { surface: 'none', severity: 'error' },
      });
      return of(null);
    }), startWith<IChat | null>(null));
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
