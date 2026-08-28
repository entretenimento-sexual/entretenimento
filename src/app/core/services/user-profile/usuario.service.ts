// src/app/core/services/usuario.service.ts
// Serviço legado para operações editáveis do usuário.
// - Este service está com ideia de ser descontinuado (ok), mas enquanto existir,
//   deve manter compat com fluxos antigos ainda válidos.
// - Escritas sempre via FirestoreWriteService (context + erro centralizado).
//
// SUPRESSÃO EXPLÍCITA:
// - updateUserRole() foi removido.
//
// Motivo:
// - free/basic/premium/vip pertencem ao entitlement de assinatura e não podem
//   possuir um caminho de escrita pelo cliente;
// - as Rules já bloqueavam a operação;
// - a projeção de role/tier é responsabilidade exclusiva do backend financeiro.
import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import {
  PROFILE_IDENTITY_CATALOG_VERSION,
  isSelectableProfileIdentityCode,
} from '../../domain/profile-identity/profile-identity.catalog';
import { FirestoreWriteService } from '../data-handling/firestore/core/firestore-write.service';
import { IUserDados } from '../../interfaces/iuser-dados';

type EditableUserPatch = Partial<IUserDados> & {
  declaredIdentityCode?: string;
  identityCatalogVersion?: number;
};

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
      // não dar throw síncrono (mantém tudo no fluxo Rx)
      return throwError(() => new Error('UID inválido em atualizarUsuario().'));
    }

    const gender = dados.gender == null
      ? undefined
      : String(dados.gender).trim().toLowerCase();
    if (gender !== undefined && !isSelectableProfileIdentityCode(gender)) {
      const error = new Error('A identificação de perfil informada é inválida.') as Error & {
        code?: string;
      };
      error.code = 'profile/invalid-gender';
      return throwError(() => error);
    }

    // whitelist de campos que o usuário pode editar
    const patch: EditableUserPatch = {
      nickname: dados.nickname ?? undefined,
      estado: dados.estado ?? undefined,
      municipio: dados.municipio ?? undefined,
      gender,
      declaredIdentityCode: gender,
      identityCatalogVersion: gender === undefined
        ? undefined
        : PROFILE_IDENTITY_CATALOG_VERSION,
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
} // fim UsuarioService
// Não esquecer comentários explicativos sobre o propósito do serviço, decisões de design e relação com outros serviços (ex: UserProfileService, PresenceService etc).
// *** ATENÇÃO *** Estou com ideia de descontinuar esse service
/* O que ele não deveria fazer
❌ Presença(isOnline / lastSeen) → isso é 100 % PresenceService.
❌ Query de online users → isso é UserPresenceQueryService.
❌ Gerenciar vínculos de chat(roomIds) → isso é chat - domain.
❌ Depender do EmailVerificationService para update genérico → acoplamento perigoso.
❌ Alterar role/tier/isSubscriber → isso é projeção do entitlement no backend.
*/
