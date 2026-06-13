//src\app\explore\facades\explore-feed.facade.ts
import { Injectable, inject } from '@angular/core';

import { ExploreFeedService } from '../services/explore-feed.service';

@Injectable({ providedIn: 'root' })
export class ExploreFeedFacade {
  private readonly exploreFeed = inject(ExploreFeedService);

  readonly vm$ = this.exploreFeed.vm$;
}
