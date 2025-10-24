// src/app/store/selectors/selectors.interactions/friends/vm-selectors/vm.utils.ts
import { AppState } from '../../../../states/app.state';

export const selectPresenceMap = (state: AppState) =>
  ((state as any)?.presence?.byUid ?? {}) as Record<string, boolean>;

export const selectUsersMap = (state: AppState) =>
  ((state as any)?.user?.users ?? {}) as Record<string, any>;

export const shorten = (uid?: string) => (uid ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : '');

export const getAvatar = (u?: any) => u?.photoURL || u?.avatarUrl || u?.imageUrl || undefined;

export const tsMs = (t: any): number => {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  if (t?.seconds) return t.seconds * 1000;
  const d = new Date(t);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

export const calcAge = (birth?: any): number | undefined => {
  if (!birth) return undefined;
  let d: Date;
  if (birth?.seconds) d = new Date(birth.seconds * 1000);
  else d = new Date(birth);
  if (isNaN(d.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
};

/* ---------------- Fotos: agrega de vários possíveis campos e normaliza ---------------- */
const pickArray = (v: any): string[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') return [v];
  return [];
};

export const pluckPhotos = (u?: any): string[] => {
  const candidates = [
    u?.photos,
    u?.publicPhotos,
    u?.gallery,
    u?.images,
    u?.photoUrls,
    u?.latestPhotos,
    u?.media?.photos,
  ];
  const urls = candidates
    .flatMap(pickArray)
    .map((x: any) => (typeof x === 'string' ? x : x?.url ?? x))
    .filter((s: any) => typeof s === 'string' && s.length > 0);
  // dedup
  return Array.from(new Set(urls));
};

export const pickUser = (u?: any) => ({
  nickname: u?.nickname ?? u?.displayName,
  avatarUrl: getAvatar(u),
  gender: u?.gender,
  orientation: u?.orientation,
  municipio: u?.municipio,
  estado: u?.estado,
  isOnline: u?.isOnline,
  lastSeen: u?.lastSeen,
  role: u?.role,
  age: calcAge(u?.birthDate ?? u?.birthdate ?? u?.dataNascimento),
  photos: pluckPhotos(u), // <<<<<<<<<<  padroniza aqui
});
