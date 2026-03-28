// src/app/core/utils/preferences/preference-paths.ts
export const preferencePaths = {
  profileMain: (uid: string) => `users/${uid}/preferences/main`,
  intentCurrent: (uid: string) => `users/${uid}/intent/current`,
  matchProfile: (uid: string) => `match_profiles/${uid}`,
};