// src/app/core/services/usuario.service.ts
// Serviço para gerenciar operações relacionadas ao usuário.
// - Este service está com ideia de ser descontinuado (ok), mas enquanto existir,
//   deve manter compat com Effects/fluxos antigos.
// - Escritas sempre via FirestoreWriteService (context + erro centralizado).
import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { FirestoreWriteService } from '../data-handling/firestore/core/firestore-write.service';
import { IUserDados } from '../../interfaces/iuser-dados';

@Injectable({ providedIn: 'root' })
export class UsuarioService {
  constructor(
    private readonly write: FirestoreWriteService,
  ) { }

  /**
   * Atualiza APENAS campos “editáveis pelo usuário” no doc users/{uid}.
   * Evita permission-denied por rules (role/isSubscriber/tier/moderação etc).
   */
  atualizarUsuario(uid: string, dados: Partial<IUserDados>): Observable<void> {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) {
      // ✅ não dar throw síncrono (mantém tudo no fluxo Rx)
      return throwError(() => new Error('UID inválido em atualizarUsuario().'));
    }

    // ✅ whitelist de campos que o usuário pode editar
    const patch: Partial<IUserDados> = {
      nickname: dados.nickname ?? undefined,
      estado: dados.estado ?? undefined,
      municipio: dados.municipio ?? undefined,
      gender: dados.gender ?? undefined,
      orientation: dados.orientation ?? undefined,
      partner1Orientation: dados.partner1Orientation ?? undefined,
      partner2Orientation: dados.partner2Orientation ?? undefined,
      descricao: dados.descricao ?? undefined,
      photoURL: dados.photoURL ?? undefined,

      // se você realmente mantém isso no users doc:
      preferences: dados.preferences ?? undefined,
      isSidebarOpen: dados.isSidebarOpen ?? undefined,
    };

    // Remove undefined para não “mexer” em campos sem necessidade
    Object.keys(patch).forEach((k) => {
      const key = k as keyof typeof patch;
      if (patch[key] === undefined) delete patch[key];
    });

    return this.write.updateDocument('users', safeUid, patch, {
      context: 'UsuarioService.atualizarUsuario',
      silent: false,
    });
  }

  /**
   * ✅ COMPAT com NgRx Effects existentes.
   *
   * Atualiza role no doc users/{uid}.
   * IMPORTANTE: com suas rules atuais, isso tende a dar permission-denied.
   * (role está bloqueado tanto para self quanto para admin).
   */
  updateUserRole(uid: string, newRole: string): Observable<void> {
    const safeUid = (uid ?? '').trim();
    const safeRole = (newRole ?? '').trim();

    if (!safeUid) {
      return throwError(() => new Error('UID inválido em updateUserRole().'));
    }
    if (!safeRole) {
      return throwError(() => new Error('newRole inválido em updateUserRole().'));
    }

    // (Opcional) hardening: restringe valores aceitos
    // Se você quiser manter totalmente livre, remova este bloco.
    const allowed = new Set<IUserDados['role']>(['visitante', 'free', 'basic', 'premium', 'vip']);
    if (!allowed.has(safeRole as any)) {
      return throwError(() => new Error(`Role inválida: ${safeRole}`));
    }

    return this.write.updateDocument('users', safeUid, { role: safeRole } as any, {
      context: 'UsuarioService.updateUserRole',
      silent: false,
    });
  }
} //Linha 87, fim UsuarioService
// Não esquecer comentários explicativos sobre o propósito do serviço, decisões de design e relação com outros serviços (ex: UserProfileService, PresenceService etc).
// *** ATENÇÃO *** Estou com ideia de descontinuar esse service
/* O que ele não deveria fazer
❌ Presença(isOnline / lastSeen) → isso é 100 % PresenceService.
❌ Query de online users → isso é UserPresenceQueryService.
❌ Gerenciar vínculos de chat(roomIds) → isso é chat - domain.
❌ Depender do EmailVerificationService para update genérico → acoplamento perigoso.
*/
/*
Atenção importante (produto / rules): com as regras que você colou (users.rules),
ninguém consegue alterar role (nem self, nem admin), porque:
- self é bloqueado por selfChangingSensitiveKeys() (inclui "role")
- admin é limitado por adminModerationOnly() (não inclui "role")
Então: isso vai compilar, mas vai dar permission-denied em runtime até você decidir a política
(ex.: role via backend/claims, ou liberar role para admin em rules, etc.).
*/
