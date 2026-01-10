// src/app/store/states/states.user/auth.state.ts
export interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;          // (pode manter esse nome)
  emailVerified: boolean;          // ✅ novo
  ready: boolean;                  // ✅ novo (sessão já foi checada)
  loading: boolean;
  error: any;
}

export const initialAuthState: AuthState = {
  isAuthenticated: false,
  userId: null,
  emailVerified: false,
  ready: false,
  loading: false,
  error: null,
};
