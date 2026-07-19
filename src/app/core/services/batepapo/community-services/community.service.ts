// src/app/core/services/batepapo/community-services/community.service.ts
// -----------------------------------------------------------------------------
// LEGACY COMMUNITY SERVICE
// -----------------------------------------------------------------------------
//
// As nomenclaturas públicas são preservadas para não quebrar consumidores antigos,
// mas os acessos diretos a `communities`, `members` e `invites` foram suprimidos.
// Essas operações agora pertencem exclusivamente a repositories/callables que
// validam autenticação, assinatura, papel, moderação, idempotência e auditoria.
// -----------------------------------------------------------------------------

import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';

import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { Community } from 'src/app/core/interfaces/interfaces-chat/community.interface';

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
   * @deprecated Convites devem passar por backend autoritativo. O fluxo legado
   * gravava o documento diretamente e não garantia o ciclo completo de segurança.
   */
  async sendInvite(_inviteData: Omit<Invite, 'id'>): Promise<void> {
    void _inviteData;
    throw this.unsupported('sendInvite');
  }

  /**
   * @deprecated Listas de membros são privadas e precisam ser sanitizadas por
   * callable com validação de papel. As Rules bloqueiam enumeração direta.
   */
  observeCommunityMembers(_communityId: string): Observable<unknown[]> {
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
