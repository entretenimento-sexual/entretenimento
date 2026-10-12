// src/app/messaging/direct-chat/services/direct-receipts.service.ts
// ============================================================================
// DIRECT RECEIPTS SERVICE
//
// Responsabilidade:
// - avançar recibos de leitura de mensagens diretas 1:1;
// - respeitar as Firestore Rules:
//   sent      -> delivered
//   delivered -> read
//
// Importante:
// - o cliente NÃO pode fazer sent -> read diretamente;
// - por isso o avanço precisa ser progressivo;
// - falha de receipts é best-effort e não deve quebrar a thread.
// ============================================================================

import { DestroyRef, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { combineLatest, defer, from, Observable, of } from 'rxjs';
import { catchError, filter, finalize, map, mergeMap, switchMap, take, takeUntil, tap, toArray } from 'rxjs/operators';

import { Message } from 'src/app/core/interfaces/interfaces-chat/message.interface';

import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { ChatService } from '@core/services/batepapo/chat-service/chat.service';
import { PrivacyDebugLoggerService } from '@core/services/privacy/privacy-debug-logger.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';

type ReceiptTransitionTarget = 'delivered' | 'read';

type ReceiptTransition = {
  messageId: string;
  nextStatus: ReceiptTransitionTarget;
};

@Injectable({ providedIn: 'root' })
export class DirectReceiptsService {
  private readonly maxUpdatesPerTick = 50;
  private readonly maxConcurrentUpdates = 5;
  private readonly pendingTransitions = new Set<string>();
  private readonly confirmedTransitions = new Map<string, number>();
  private readonly confirmationTtlMs = 30_000;
  private readonly maxConfirmedEntries = 512;
  private receiptSessionUid: string | null = null;

  private rememberConfirmed(key: string): void {
    const now = Date.now();
    for (const [entry, time] of this.confirmedTransitions) {
      if (now - time >= this.confirmationTtlMs) this.confirmedTransitions.delete(entry);
    }
    this.confirmedTransitions.delete(key);
    if (this.confirmedTransitions.size >= this.maxConfirmedEntries) {
      const oldest = this.confirmedTransitions.keys().next().value;
      if (oldest !== undefined) this.confirmedTransitions.delete(oldest);
    }
    this.confirmedTransitions.set(key, now);
  }

  constructor(
    private readonly chatService: ChatService,
    private readonly applicationError: ApplicationErrorService,
    private readonly privacyDebug: PrivacyDebugLoggerService,
    private readonly accessControl: AccessControlService,
    destroyRef: DestroyRef
  ) {
    // Limpa confirmações mesmo sem novas chamadas após logout/revogação.
    combineLatest([
      this.accessControl.authUid$,
      this.accessControl.canListenRealtime$,
    ]).pipe(takeUntilDestroyed(destroyRef)).subscribe(([uid, allowed]) => {
      if (this.receiptSessionUid !== uid || !allowed) {
        this.confirmedTransitions.clear();
        this.receiptSessionUid = uid;
      }
    });
  }

  /**
   * Avança recibos das mensagens recebidas.
   *
   * Regras:
   * - mensagem minha: nunca altera;
   * - mensagem sem id: ignora;
   * - read: ignora;
   * - sent: avança para delivered;
   * - delivered: avança para read.
   *
   * Observação:
   * - uma mensagem sent não vira read diretamente por causa das Rules;
   * - depois que o snapshot atualizar para delivered, esta função pode avançar
   *   novamente para read.
   */
  markDeliveredAsRead$(
    chatId: string,
    currentUserUid: string,
    messages: Message[]
  ): Observable<number> {
    const safeChatId = (chatId ?? '').trim();
    const safeUid = (currentUserUid ?? '').trim();
    const safeMessages = Array.isArray(messages) ? messages : [];

    if (!safeChatId || !safeUid || !safeMessages.length) {
      return of(0);
    }

    const transitions = this.pickReceiptTransitions(safeUid, safeMessages);
    if (!transitions.length) {
      return of(0);
    }

    const access$ = combineLatest([
      this.accessControl.authUid$,
      this.accessControl.canListenRealtime$,
    ]);

    return access$.pipe(
      take(1),
      switchMap(([uid, canListen]) => {
        if (this.receiptSessionUid !== uid || !canListen) {
          this.confirmedTransitions.clear();
          this.receiptSessionUid = uid;
        }
        if (uid !== safeUid || !canListen) return of(0);

        return from(transitions.map((transition, index) => ({ transition, index }))).pipe(
          mergeMap(({ transition, index }) =>
            defer(() => {
              // Coalesce apenas a MESMA transição. delivered -> read deve
              // continuar possível quando o snapshot local avançar de status.
              const key = JSON.stringify([
                safeUid, safeChatId, transition.messageId, transition.nextStatus,
              ]);
              const confirmedAt = this.confirmedTransitions.get(key);
              if (confirmedAt !== undefined && Date.now() - confirmedAt < this.confirmationTtlMs) {
                return of({ index, confirmed: false });
              }
              if (this.pendingTransitions.has(key)) {
                return of({ index, confirmed: false });
              }
              this.pendingTransitions.add(key);

              return defer(() =>
                this.chatService.updateMessageStatus(
                  safeChatId,
                  transition.messageId,
                  transition.nextStatus
                )
              ).pipe(
                map(() => {
                  this.rememberConfirmed(key);
                  return { index, confirmed: true };
                }),
                catchError((error) => {
                  this.reportIfUnreported(
                    error,
                    'DirectReceiptsService.markDeliveredAsRead$.updateMessageStatus',
                    {
                      chatId: safeChatId,
                      messageId: transition.messageId,
                      nextStatus: transition.nextStatus,
                    }
                  );
                  return of({ index, confirmed: false });
                }),
                finalize(() => this.pendingTransitions.delete(key))
              );
            }), this.maxConcurrentUpdates),
          toArray(),
          takeUntil(access$.pipe(
            filter(([activeUid, allowed]) => activeUid !== safeUid || !allowed),
            tap(() => this.confirmedTransitions.clear())
          )),
          tap((results) => {
            const confirmed = results
              .filter((result) => result.confirmed)
              .map((result) => transitions[result.index]);
            this.dbg('markDeliveredAsRead$', {
              chatId: safeChatId,
              attemptedCount: transitions.length,
              confirmedCount: confirmed.length,
              deliveredCount: confirmed.filter(
                (transition) => transition.nextStatus === 'delivered'
              ).length,
              readCount: confirmed.filter(
                (transition) => transition.nextStatus === 'read'
              ).length,
            });
          }),
          map((results) => results.filter((result) => result.confirmed).length),
          catchError((error) => {
            this.reportIfUnreported(
              error,
              'DirectReceiptsService.markDeliveredAsRead$',
              { chatId: safeChatId }
            );
            return of(0);
          })
        );
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private pickReceiptTransitions(
    currentUserUid: string,
    messages: Message[]
  ): ReceiptTransition[] {
    const seen = new Set<string>();
    return messages
      .map((message): ReceiptTransition | null => {
        const messageId = String(message?.id ?? '').trim();

        if (!messageId || message?.deleted === true) {
          return null;
        }

        // Ambos os campos existem em mensagens legadas; nenhum pode identificar
        // o destinatário como autor para fins de recibos.
        if (message?.senderId === currentUserUid ||
            message?.senderUid === currentUserUid) {
          return null;
        }

        const status = message?.status;

        if (status === 'sent') {
          return {
            messageId,
            nextStatus: 'delivered',
          };
        }

        if (status === 'delivered') {
          return {
            messageId,
            nextStatus: 'read',
          };
        }

        return null;
      })
      .filter((transition): transition is ReceiptTransition => {
        if (!transition || seen.has(transition.messageId)) return false;
        seen.add(transition.messageId);
        return true;
      })
      .slice(0, this.maxUpdatesPerTick);
  }

  private dbg(message: string, extra?: unknown): void {
    this.privacyDebug.log('chat', `DirectReceiptsService: ${message}`, extra);
  }

  private reportIfUnreported(
    error: unknown,
    context: string,
    extra?: Record<string, unknown>
  ): void {
    // ChatService já registra o erro canônico; não repetir o mesmo diagnóstico.
    if ((error as { chatApplicationErrorReported?: boolean } | null)
      ?.chatApplicationErrorReported === true) {
      return;
    }
    this.reportSilent(error, context, extra);
  }

  private reportSilent(
    error: unknown,
    context: string,
    extra?: Record<string, unknown>
  ): void {
    try {
      this.applicationError.report(error, {
        feature: 'direct-receipts',
        operation: context,
        fallbackMessage:
          'Não foi possível concluir uma atualização interna de recibo.',
        presentation: { surface: 'none', severity: 'error' },
        metadata: {
          scope: 'DirectReceiptsService',
          context,
          ...(extra ?? {}),
        },
      });
    } catch {
      // Receipts são best-effort e nunca podem quebrar a thread.
    }
  }
}
