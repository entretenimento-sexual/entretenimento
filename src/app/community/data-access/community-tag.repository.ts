// src/app/community/data-access/community-tag.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map, shareReplay } from 'rxjs';

import {
  CommunityTagCatalog,
  normalizeCommunityTagCatalog,
} from './community-tag.model';

@Injectable({ providedIn: 'root' })
export class CommunityTagRepository {
  private readonly functions = inject(Functions);

  private readonly getCommunityTagCatalogCallable = httpsCallable<
    Record<string, never>,
    unknown
  >(this.functions, 'getCommunityTagCatalog');

  private readonly catalog$ = defer(() =>
    from(this.getCommunityTagCatalogCallable({}))
  ).pipe(
    map((result) => normalizeCommunityTagCatalog(result.data)),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  getCommunityTagCatalog$(): Observable<CommunityTagCatalog> {
    return this.catalog$;
  }
}
