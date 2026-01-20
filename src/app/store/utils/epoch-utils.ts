// src/app/core/utils/epoch-utils.ts
import type { Timestamp } from 'firebase/firestore';

export type AnyDateLike = Timestamp | Date | number | null | undefined;

/** ✅ conversor central */
export function toEpoch(v: AnyDateLike): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (typeof (v as any)?.toMillis === 'function') return (v as any).toMillis();
  return null;
}
