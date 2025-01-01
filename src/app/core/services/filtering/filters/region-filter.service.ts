//src\app\core\services\filtering\filters\region-filter.service.ts
import { Injectable } from '@angular/core';
import { QueryConstraint, where } from 'firebase/firestore';

@Injectable({
  providedIn: 'root',
})
export class RegionFilterService {
  applyFilter(uf?: string, city?: string): QueryConstraint[] {
    const constraints: QueryConstraint[] = [];
    if (uf) constraints.push(where('uf', '==', uf));
    if (city) constraints.push(where('city', '==', city));
    return constraints;
  }
}
