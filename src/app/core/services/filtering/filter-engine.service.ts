//src\app\core\services\filtering\filter-engine.service.ts
import { Injectable } from '@angular/core';
import { QueryConstraint } from 'firebase/firestore';

@Injectable({
  providedIn: 'root',
})
export class FilterEngineService {
  private constraints: QueryConstraint[] = [];

  addConstraint(constraint: QueryConstraint): void {
    this.constraints.push(constraint);
  }

  getConstraints(): QueryConstraint[] {
    return this.constraints;
  }

  clearConstraints(): void {
    this.constraints = [];
  }
}
