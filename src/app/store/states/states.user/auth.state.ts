// src/app/store/states/states.user/auth.state.ts
export interface AuthState {
  isAuthenticated: boolean;      // Indica se o usuário está autenticado
  userId: string | null;         // ID do usuário autenticado
  loading: boolean;              // Indica se a autenticação está em progresso
  error: string | null;          // Mensagem de erro em caso de falha na autenticação
}

export const initialAuthState: AuthState = {
  isAuthenticated: false,
  userId: null,
  loading: false,
  error: null,
};
