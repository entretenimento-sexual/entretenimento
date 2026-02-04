// src/app/core/services/batepapo/chat-service/chat-policy.service.ts
// Não esqueça os comentários
import { Injectable } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { IUserDados } from '@core/interfaces/iuser-dados';

export interface ChatPolicyDecision {
  canRead: boolean;
  canSend: boolean;
  reason?: string;
}

@Injectable({ providedIn: 'root' })
export class ChatPolicyService {
  // Ajuste conforme sua regra real
  private readonly MAX_MESSAGE_LEN = 2000;

  constructor(
    private readonly currentUserStore: CurrentUserStoreService
  ) { }

  /**
   * policy$:
   * - Centraliza decisão de permissão no CLIENTE (UX).
   * - Regra FINAL deve existir em Firestore Rules / Cloud Functions.
   */
  readonly policy$: Observable<ChatPolicyDecision> = this.currentUserStore.user$.pipe(
    map((u) => this.computePolicy(u)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  canSendMessage$(content?: string): Observable<ChatPolicyDecision> {
    if (content != null && content.length > this.MAX_MESSAGE_LEN) {
      return of({ canRead: true, canSend: false, reason: 'Mensagem muito longa.' });
    }
    return this.policy$;
  }

  private computePolicy(u: IUserDados | null | undefined): ChatPolicyDecision {
    if (u === undefined) return { canRead: false, canSend: false, reason: 'Carregando perfil...' };
    if (u === null) return { canRead: false, canSend: false, reason: 'Não autenticado.' };

    const role = (u as any)?.role?.toString?.().toLowerCase?.() ?? 'user';
    const banned = (u as any)?.isBanned === true || (u as any)?.isSuspended === true;

    if (banned) return { canRead: false, canSend: false, reason: 'Conta restrita.' };

    // Exemplo: roles que podem ler mas não podem enviar
    if (role === 'readonly' || role === 'guest') {
      return { canRead: true, canSend: false, reason: 'Seu perfil não pode enviar mensagens.' };
    }

    return { canRead: true, canSend: true };
  }
}
