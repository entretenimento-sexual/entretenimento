// functions/src/chat/rooms/domain/room-capability-policy.ts
// -----------------------------------------------------------------------------
// ROOM CAPABILITY POLICY
// -----------------------------------------------------------------------------
// Centraliza decisões de produto e autorização derivadas do entitlement válido.
//
// DIREÇÃO DE PRODUTO — SALAS INDEPENDENTES CONGELADAS
// -----------------------------------------------------------------------------
// Este domínio está em manutenção/compatibilidade e NÃO deve receber expansão
// funcional. Comunidades são a fonte canônica para interação social coletiva;
// não existe um segundo produto "chat da Comunidade": a própria Comunidade é a
// superfície coletiva normal da plataforma.
//
// Permitido neste domínio enquanto houver legado:
// - correções de segurança, integridade, privacidade e custo;
// - compatibilidade com salas, convites e notificações já persistidos;
// - migração, encerramento e remoção segura do legado.
//
// Não adicionar aqui:
// - discovery/ranking, feed, novos papéis ou outra árvore de membership;
// - novos canais/mensagens, deep-links ou superfícies sociais;
// - novas regras de monetização, quotas comerciais ou integração oficial;
// - novas capacidades ligadas a Local. `placeIntent` é legado; qualquer evolução
//   desse conceito deve nascer no domínio canônico de Comunidades/Locais.
//
// Chat direto pessoa-a-pessoa permanece um domínio separado e não faz parte deste
// congelamento.
// -----------------------------------------------------------------------------
import type { PlatformRole } from '../../../payments/domain/billing.model';

export const PRIVATE_ROOM_POLICY_VERSION = 'private-room-v2' as const;

export interface PrivateRoomCreationCapabilities {
  canCreatePrivateRoom: boolean;
  canUseVenueIntent: boolean;
  maxOwnedActiveRooms: number;
}

const PRIVATE_ROOM_CREATION_CAPABILITIES: Record<
  PlatformRole,
  PrivateRoomCreationCapabilities
> = {
  basic: {
    canCreatePrivateRoom: true,
    canUseVenueIntent: false,
    maxOwnedActiveRooms: 1,
  },
  premium: {
    canCreatePrivateRoom: true,
    canUseVenueIntent: true,
    maxOwnedActiveRooms: 1,
  },
  vip: {
    canCreatePrivateRoom: true,
    canUseVenueIntent: true,
    maxOwnedActiveRooms: 1,
  },
};

/**
 * @deprecated Salas independentes estão congeladas. Preserve esta resolução
 * apenas para compatibilidade e migração do legado; não acrescente capacidades.
 */
export function resolvePrivateRoomCreationCapabilities(
  role: PlatformRole
): PrivateRoomCreationCapabilities {
  return PRIVATE_ROOM_CREATION_CAPABILITIES[role];
}
