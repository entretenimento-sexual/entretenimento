//src\app\shared\pagination\page.constants.ts
export const PAGE_SIZES = {
  FRIENDS_PAGE: 24,
  FRIENDS_DASHBOARD: 8,     // ou 6/12 conforme seu layout
  REQUESTS_PAGE: 24,
  BLOCKED_PAGE: 24,
  ROOMS_PAGE: 24,
  MESSAGES_PAGE: 30,
  SUGGESTIONS_PAGE: 24,
} as const;
export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;
