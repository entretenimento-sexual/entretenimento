// src/app/core/services/data-handling/firestore/repositories/chat.repository.ts
import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, defer, of, throwError } from 'rxjs';
import { catchError, distinctUntilChanged, filter, map, startWith, switchMap, take } from 'rxjs/operators';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { createChatDiscoveryScope$, type ChatDiscoveryScope } from './chat-discovery-scope';
import { revalidateDiscoveryOnRevision$ } from './chat-discovery-invalidation';
import { createSharedChatRevision$, type SharedChatRevision } from './chat-shared-revision';
import { createSharedChatSnapshots } from './chat-shared-snapshots';
import { observeDirectChatPages$, type DirectChatPageResponse, type DirectChatPageState } from './chat-discovery-pages';
import { observeConfirmedDirectChatInbox$, revokedDirectChatInbox, type DirectChatInboxScope } from './chat-inbox-projection';
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

  private readonly sharedRevision$ = createSharedChatRevision$(
    this.access.authUid$,
    this.access.canRunChatRealtime$,
    uid => this.observeRevisionDocument$(uid)
  );

  private readonly sharedSnapshots = createSharedChatSnapshots<IChat>(
    this.sharedRevision$, id => this.observeChat$(id)
  );

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
  private observeRevision$(uid: string): Observable<number | null> {
    return this.sharedRevision$.pipe(
      map(scope => scope.ownerUid === uid ? scope.revision : null),
      distinctUntilChanged()
    );
  }

  private observeRevisionGeneration$(uid: string): Observable<SharedChatRevision | null> {
    return this.sharedRevision$.pipe(
      map(scope => scope.ownerUid === uid && scope.revision !== null ? scope : null),
      distinctUntilChanged()
    );
  }

  private observeRevisionDocument$(uid: string): Observable<number | null> {
    return this.ctx.deferObservable$(() => {
      const ref = doc(this.db, 'direct_chat_discovery', uid);
      return new Observable<number | null>(sink => onSnapshot(ref,
        { includeMetadataChanges: true }, snapshot => {
          if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
            sink.next(null);
            return;
          }
          const data = snapshot.data();
          if (!snapshot.exists()) sink.next(0);
          else if (data?.['version'] === 1 && Number.isSafeInteger(data['revision'])) {
            sink.next(data['revision'] as number);
          } else sink.error(new Error('Sinal de descoberta inválido.'));
        }, error => sink.error(error)));
    });
  }

  // Additive paged transport; the legacy global notification scope remains
  // unchanged until the paged UI and unread projection have been certified.
  watchDirectChatPagesForOwner$(uid: string, loadMore$: Observable<unknown>): Observable<DirectChatPageState> {
    const owner = String(uid ?? '').trim();
    const revoked: DirectChatPageState = { ownerUid: null, status: 'revoked', chatIds: [], hasMore: false };
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner)) return of(revoked);
    return combineLatest([this.access.authUid$, this.access.canRunChatRealtime$]).pipe(
      map(([active, allowed]) => active === owner && allowed),
      distinctUntilChanged(),
      switchMap((allowed): Observable<DirectChatPageState> => allowed
        ? observeDirectChatPages$(owner, this.observeRevision$(owner), loadMore$, cursor =>
          this.ctx.deferPromise$(() => httpsCallable<
            { pageSize: number; cursor: string | null; order: 'activity' }, DirectChatPageResponse
          >(this.functions, 'listDirectChatCandidates')({ pageSize: 50, cursor, order: 'activity' })).pipe(map(result => result.data)),
          error => { this.failedScope(owner, error); }
        ).pipe(catchError(error => {
          this.failedScope(owner, error);
          return of({ ownerUid: owner, status: 'error', chatIds: [], hasMore: false } as DirectChatPageState);
        }))
        : of(revoked)),
      startWith<DirectChatPageState>(revoked)
    );
  }

  watchDirectChatInboxForOwner$(
    uid: string, loadMore$: Observable<unknown>, refresh$: Observable<unknown>
  ): Observable<DirectChatInboxScope> {
    return refresh$.pipe(startWith(null), switchMap(() =>
      observeConfirmedDirectChatInbox$(uid, this.watchDirectChatPagesForOwner$(uid, loadMore$),
        id => this.observeChat$(id)).pipe(
        startWith(revokedDirectChatInbox()),
        catchError(error => {
          this.failedScope(uid, error);
          return of({ ...revokedDirectChatInbox(), ownerUid: uid, status: 'error' as const });
        })
      )
    ));
  }

  private observeTransport$(uid: string): Observable<ChatDiscoveryScope> {
    const revision$ = this.observeRevisionGeneration$(uid);
    const loading: ChatDiscoveryScope = { ownerUid: uid, status: 'loading', chats: [] };
    return revalidateDiscoveryOnRevision$(revision$, loading, generation =>
      this.ctx.deferPromise$(() =>
        httpsCallable<Record<string, never>, { chatIds: string[] }>(
          this.functions, 'listDirectChatCandidates'
        )({})
      ).pipe(
        switchMap(({ data }) => {
          if (!Array.isArray(data.chatIds) || data.chatIds.some(id =>
            typeof id !== 'string' || !id || id.includes('/'))) {
            throw new Error('Resposta de descoberta inválida.');
          }
          const ids = [...new Set(data.chatIds)];
          if (!ids.length) return of({ ownerUid: uid, status: 'ready', chats: [] } as ChatDiscoveryScope);
          return combineLatest(ids.map(id => this.sharedSnapshots(generation, id))).pipe(
            map(chats => ({ ownerUid: uid, status: 'ready' as const,
              chats: chats.filter((chat): chat is IChat => chat !== null) }))
          );
        }),
        catchError(error => of(this.failedScope(uid, error)))
      )
    );
  }

  // A selected history is not a member of a visible page. Revalidate the
  // canonical individual candidate on every owner revision, before Rules reads.
  watchDirectChatForOwner$(uid: string, chatId: string): Observable<IChat | null> {
    const owner = String(uid ?? '').trim();
    const id = String(chatId ?? '').trim();
    if (!owner || !id || owner.includes('/') || id.includes('/') ||
        id === '.' || id === '..' || /^__.*__$/.test(id)) return of(null);
    return combineLatest([this.access.authUid$, this.access.canRunChatRealtime$]).pipe(
      map(([active, allowed]) => active === owner && allowed),
      distinctUntilChanged(),
      switchMap((allowed): Observable<IChat | null> => allowed ? recoverDirectChatListener$<IChat | null>(
        () => revalidateDiscoveryOnRevision$(this.observeRevisionGeneration$(owner), null as IChat | null, generation =>
          recoverDirectChatListener$<IChat | null>(() => this.ctx.deferPromise$(() =>
            httpsCallable<{ chatId: string }, { chatIds: string[] }>(
              this.functions, 'listDirectChatCandidates'
            )({ chatId: id })
          ).pipe(
            switchMap(({data}) => Array.isArray(data.chatIds) &&
              data.chatIds.length === 1 && data.chatIds[0] === id
                ? this.sharedSnapshots(generation, id) : of(null))
          ), error => {
            this.failedScope(owner, error);
            return null;
          })
        ), error => {
          this.failedScope(owner, error);
          return null;
        }
      ).pipe(catchError(error => {
        this.failedScope(owner, error);
        return of(null);
      })) : of(null)),
      startWith<IChat | null>(null)
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
      }), () => null, undefined, undefined, { isConfirmed: chat => chat !== null }
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
