//src\app\core\services\filtering\filters\gender-filter.service.ts
import { Injectable } from '@angular/core';
import { QueryConstraint, where } from 'firebase/firestore';

@Injectable({
  providedIn: 'root',
})
export class GenderFilterService {
  applyFilter(gender?: string): QueryConstraint[] {
    return gender ? [where('gender', '==', gender)] : [];
  }
}
