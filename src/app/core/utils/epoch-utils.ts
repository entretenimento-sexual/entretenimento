// src\app\core\utils\epoch-utils.ts
import { Timestamp } from 'firebase/firestore';

export type AnyDateLike = Timestamp | Date | number | null | undefined;

/** ✅ conversor central (para Store / JSON-safe) */
export function toEpoch(v: AnyDateLike): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof (v as any)?.toMillis === 'function') return (v as any).toMillis();
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
