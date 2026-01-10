//src\app\shared\pagination\page.types.ts
import type { Timestamp } from 'firebase/firestore';

export interface PageResult<T> {
  items: T[];
  /** Próximo valor do campo ordenado (ex.: último `since` da página) */
  nextOrderValue: Timestamp | string | number | null;
  reachedEnd: boolean;
}

/** Convenção das chaves/nomes de campos usados no orderBy por domínio */
export type OrderableField = 'since' | 'createdAt' | 'updatedAt' | 'lastMessageAt';
export type OrderDirection = 'asc' | 'desc';

export interface PageRequest {
  pageSize: number;
  orderBy: OrderableField;
  orderDirection: OrderDirection;
  /** Valor do campo ordenado para início da próxima página */
  startAfter?: Timestamp | string | number;
}
