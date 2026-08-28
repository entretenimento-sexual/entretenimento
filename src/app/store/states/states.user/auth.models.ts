// src/app/store/states/states.user/auth.models.ts
export interface AuthError {
  message: string;
  code?: string;
}

export interface AuthTokenModel {
  userId: string | null;
  token: string | null;
  isAuthenticated: boolean;
  error: AuthError | null;
}
