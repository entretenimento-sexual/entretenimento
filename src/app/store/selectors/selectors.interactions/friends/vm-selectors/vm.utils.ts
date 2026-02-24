// src\app\store\selectors\selectors.interactions\friends\vm-selectors\vm.utils.ts
// Este arquivo contém utilitários para os selectors de friends VM, como selectPresenceMap, selectUsersMap, shorten, getAvatar, tsMs, calcAge, pluckPhotos e pickUser.
// Ele é importado pelos selectors para manter a lógica de transformação de dados centralizada e reutilizável.
// Qualquer função que envolva manipulação ou formatação de dados relacionados a usuários, presença ou fotos deve ser colocada aqui, para evitar duplicação e garantir consistência em toda a aplicação.
import { AppState } from '../../../../states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { toEpoch, toEpochOrZero } from 'src/app/core/utils/epoch-utils';

export const selectPresenceMap = (state: AppState): Record<string, boolean> => {
  const list = state?.user?.onlineUsers ?? [];
  const map: Record<string, boolean> = {};
  for (const u of list) if (u?.uid) map[u.uid] = true;
  return map;
};

export const selectUsersMap = (state: AppState) =>
  (state?.user?.users ?? {}) as Record<string, IUserDados>;

export const shorten = (uid?: string) => (uid ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : '');
export const getAvatar = (u?: any) => u?.photoURL || u?.avatarUrl || u?.imageUrl || undefined;

/** ✅ padroniza via epoch-utils */
export const tsMs = (t: any): number => toEpochOrZero(t);

/** ✅ calcAge puro (sem DI) */
export const calcAge = (birth?: any): number | undefined => {
  const ms = toEpoch(birth);
  if (ms == null) return undefined;

  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;

  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
};

// fotos... (mantém como você já fez)
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
  photos: pluckPhotos(u),
});

// Sempre lembrar do src\app\core\utils\epoch-utils.ts
// para funções como tsMs e calcAge, para centralizar utilitários relacionados a datas/epoch.
// Colocar os donos do isOnline/lastSeen no IUserDados,
// para evitar confusão sobre onde esses campos devem ser atualizados e lidos.
// E o fluxo de presença deve ser controlado exclusivamente pelo PresenceService,
// sem "simulações" em outros lugares (ex: Auth).
// Isso ajuda a manter uma fonte de verdade clara para o status online dos usuários, e evita que diferentes partes do código tentem "adivinhar" ou "simular" esse status, o que pode levar a inconsistências e bugs difíceis de rastrear.
/*
Fonte de verdade por camada

Store / Selectors / VM utils (puro)
Representação canônica: epoch ms (number | null)
Ferramenta única: src/app/core/utils/epoch-utils.ts
Proibição prática: nada de Timestamp, DateTimeService, date-fns, new Date(x) espalhado em selector/vm.
*/
