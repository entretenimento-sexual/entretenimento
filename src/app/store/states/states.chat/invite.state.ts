// src/app/store/states/states.chat/invite.state.ts
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';

export interface InviteState {
  invites: Invite[];      // Lista de convites
  loading: boolean;       // Indicador de carregamento
  error: string | null;   // Mensagem de erro, se houver
}

export const initialInviteState: InviteState = {
  invites: [],
  loading: false,
  error: null,
};
