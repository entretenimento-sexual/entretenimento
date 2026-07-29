// src/app/core/services/batepapo/community-services/community.service.ts
// -----------------------------------------------------------------------------
// LEGACY COMMUNITY SERVICE
// -----------------------------------------------------------------------------
//
// As nomenclaturas públicas são preservadas para não quebrar consumidores antigos,
// mas os acessos diretos a `communities`, `members` e convites foram suprimidos.
// Essas operações agora pertencem exclusivamente a repositories/callables que
// validam autenticação, assinatura, papel, moderação, idempotência e auditoria.
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';

import { Community } from 'src/app/core/interfaces/interfaces-chat/community.interface';

/**
 * Contrato legado isolado apenas para preservar a assinatura pública desativada.
 *
 * SUPRESSÃO EXPLÍCITA:
 * - CommunityService não reutiliza mais o tipo Invite do domínio de salas;
 * - isso não implementa convite comunitário;
 * - o futuro fluxo terá contrato e callable próprios.
 */
interface LegacyCommunityInvitePayload {
  communityId?: string;
  senderId?: string;
  receiverId?: string;
  status?: string;
  [key: string]: unknown;
}

@Injectable({
  providedIn: 'root',
})
export class CommunityService {
  /**
   * @deprecated Use CommunityCreateRepository.createCommunity$().
   */
  async createCommunity(
    _communityData: Omit<Community, 'id' | 'createdAt'>
  ): Promise<string> {
    void _communityData;
    throw this.unsupported('createCommunity');
  }

  /**
   * @deprecated Use CommunityPreviewRepository.getMyCommunitiesPage$().
   */
  getUserCommunities(_userId: string): Observable<Community[]> {
    void _userId;
    return throwError(() => this.unsupported('getUserCommunities'));
  }

  /**
   * @deprecated A edição será exposta por callable própria quando o contrato de
   * gestão, auditoria e revisão de moderação estiver concluído.
   */
  async updateCommunity(
    _communityId: string,
    _updateData: Partial<Community>
  ): Promise<void> {
    void _communityId;
    void _updateData;
    throw this.unsupported('updateCommunity');
  }

  /**
   * @deprecated A exclusão física foi substituída pelo futuro ciclo auditável de
   * arquivamento/encerramento. Nenhum cliente pode apagar a estrutura diretamente.
   */
  async deleteCommunity(_communityId: string): Promise<void> {
    void _communityId;
    throw this.unsupported('deleteCommunity');
  }

  /**
   * @deprecated Convites comunitários devem passar por backend autoritativo.
   * O fluxo legado permanece deliberadamente desativado até existir ciclo completo.
   */
  async sendInvite(_inviteData: LegacyCommunityInvitePayload): Promise<void> {
    void _inviteData;
    throw this.unsupported('sendInvite');
  }

  /**
   * @deprecated Listas de membros são privadas e precisam ser sanitizadas por
   * callable com validação de papel. As Rules bloqueiam enumeração direta.
   */
  observeCommunityMembers(_communityId: string): Observable<any[]> {
    void _communityId;
    return throwError(() => this.unsupported('observeCommunityMembers'));
  }

  private unsupported(operation: string): Error {
    const error = new Error(
      `CommunityService.${operation} pertence ao fluxo legado e foi desativado. Use o repository/callable protegido correspondente.`
    );

    (error as Error & { context?: unknown; skipUserNotification?: boolean }).context = {
      scope: 'CommunityService',
      operation,
      reason: 'legacy-direct-write-disabled',
    };
    (error as Error & { skipUserNotification?: boolean }).skipUserNotification = true;

    return error;
  }
}
