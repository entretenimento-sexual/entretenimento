// src/app/preferences/utils/preference-paths.ts
// Paths centralizados do domínio de preferências.
// Evita string solta em múltiplos services.
export const preferencePaths = {
  profile: (uid: string) => `users/${uid}/preferences/profile`,
  intent: (uid: string) => `users/${uid}/preferences/intent`,
  matchProfile: (uid: string) => `match_profiles/${uid}`,
} as const;