// src/app/account/application/account-privilege-history.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { AccountPrivilegeHistoryPage } from '../models/account-privilege-history.model';

interface GetAccountPrivilegeHistoryRequest {
  cursor?: string;
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class AccountPrivilegeHistoryRepository {
  private readonly functions = inject(Functions);

  private readonly getHistoryCallable = httpsCallable<
    GetAccountPrivilegeHistoryRequest,
    AccountPrivilegeHistoryPage
  >(this.functions, 'getMyAccountPrivilegeHistory');

  getMyHistory$(
    cursor: string | null,
    limit = 25
  ): Observable<AccountPrivilegeHistoryPage> {
    const request: GetAccountPrivilegeHistoryRequest = { limit };
    if (cursor) request.cursor = cursor;

    return from(this.getHistoryCallable(request)).pipe(
      map((result) => ({
        items: Array.isArray(result.data?.items) ? result.data.items : [],
        nextCursor: typeof result.data?.nextCursor === 'string'
          ? result.data.nextCursor
          : null,
      }))
    );
  }
}
