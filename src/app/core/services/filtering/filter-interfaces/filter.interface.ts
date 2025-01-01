// src\app\core\services\filtering\filter-interfaces\filter.interface.ts
import { QueryConstraint } from 'firebase/firestore';

export interface Filter {
  applyFilter(...args: any[]): QueryConstraint[];
}
