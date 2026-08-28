// src/app/core/utils/epoch-utils.ts
// Este arquivo contém utilitários para conversão de datas/epoch, como toEpoch e toTimestamp.
// Ele é importado por outros arquivos, como user.firestore-converter.ts e vm.utils.ts, para centralizar a lógica de conversão de datas e evitar duplicação em toda a aplicação.
// Qualquer função relacionada à manipulação de datas, epoch ou timestamps deve ser colocada aqui, para garantir consistência e facilitar a manutenção.
import { Timestamp } from 'firebase/firestore';

export type TimestampLike = {
  seconds?: number;
  nanoseconds?: number;
  _seconds?: number;
  _nanoseconds?: number;
};

export type AnyDateLike =
  | Timestamp
  | TimestampLike
  | Date
  | number
  | string
  | null
  | undefined;

/** ✅ conversor central (para Store / JSON-safe) */
export function toEpoch(v: AnyDateLike): number | null {
  if (v == null) return null;

  // number (epoch ms)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  // Date
  if (v instanceof Date) {
    const ms = v.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  // Firestore Timestamp (ou compatível)
  if (typeof (v as any)?.toMillis === 'function') {
    const ms = (v as any).toMillis();
    return Number.isFinite(ms) ? ms : null;
  }

// Objeto { seconds, nanoseconds? } ou { _seconds, _nanoseconds? }
const seconds =
  typeof (v as any)?.seconds === 'number'
    ? (v as any).seconds
    : typeof (v as any)?._seconds === 'number'
      ? (v as any)._seconds
      : null;

if (seconds !== null) {
  const nanoseconds =
    typeof (v as any)?.nanoseconds === 'number'
      ? (v as any).nanoseconds
      : typeof (v as any)?._nanoseconds === 'number'
        ? (v as any)._nanoseconds
        : 0;

  const ms = seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
  return Number.isFinite(ms) ? ms : null;
}

  // string: numeric-like => epoch; senão, Date parse
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }

    const d = new Date(trimmed);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  return null;
}

/** ✅ par do toEpoch (para escrita Firestore) */
export function toTimestamp(v: AnyDateLike): Timestamp | null {
  const ms = toEpoch(v);
  return ms != null ? Timestamp.fromMillis(ms) : null;
}

/** conveniência (evita ?? 0 espalhado) */
export function toEpochOrZero(v: AnyDateLike): number {
  return toEpoch(v) ?? 0;
}
