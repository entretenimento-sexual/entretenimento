import { inject, Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable } from 'rxjs';
import {
  IdentityReviewCursor, IdentityReviewPage, normalizeIdentityReviewPage,
} from './identity-review.model';

@Injectable({ providedIn: 'root' })
export class IdentityReviewRepository {
  private readonly functions = inject(Functions);
  private readonly queueCallable = httpsCallable<
    { cursor?: IdentityReviewCursor }, unknown
  >(this.functions, 'getProfileIdentityReviewQueue');
  private readonly decisionCallable = httpsCallable<
    { uid: string; decision: 'APPROVE' | 'REJECT'; resolution: string },
    { status: 'APPROVED' | 'REJECTED' }
  >(this.functions, 'reviewProfileIdentityChange');

  getPage$(cursor: IdentityReviewCursor | null): Observable<IdentityReviewPage> {
    return defer(() => from(
      this.queueCallable(cursor ? { cursor } : {})
    )).pipe(map((response) => {
      const page = normalizeIdentityReviewPage(response.data);
      if (!page) throw new Error('Resposta de revisão de identidade inválida.');
      return page;
    }));
  }

  review$(
    uid: string, decision: 'APPROVE' | 'REJECT', resolution: string
  ): Observable<'APPROVED' | 'REJECTED'> {
    return defer(() => from(this.decisionCallable({ uid, decision, resolution }))).pipe(
      map((response) => {
        if (response.data?.status !== 'APPROVED' &&
            response.data?.status !== 'REJECTED') {
          throw new Error('Resposta de decisão de identidade inválida.');
        }
        return response.data.status;
      })
    );
  }
}
