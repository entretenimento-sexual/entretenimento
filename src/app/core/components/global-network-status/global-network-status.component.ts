// src/app/core/components/global-network-status/global-network-status.component.ts
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { Observable, combineLatest, concat, of, timer } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs/operators';

import { GlobalActivityService } from '../../services/network/global-activity.service';
import { NetworkStatusService } from '../../services/network/network-status.service';

interface GlobalNetworkStatusVm {
  offline: boolean;
  reconnected: boolean;
  slowOperation: boolean;
}

const RECONNECTED_NOTICE_DURATION_MS = 4_000;

@Component({
  selector: 'app-global-network-status',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './global-network-status.component.html',
  styleUrls: ['./global-network-status.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalNetworkStatusComponent {
  private readonly networkStatus = inject(NetworkStatusService);
  private readonly activity = inject(GlobalActivityService);

  private readonly reconnectedVisible$: Observable<boolean> =
    this.networkStatus.reconnected$.pipe(
      switchMap(() =>
        concat(
          of(true),
          timer(RECONNECTED_NOTICE_DURATION_MS).pipe(map(() => false))
        )
      ),
      startWith(false),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly vm$: Observable<GlobalNetworkStatusVm> = combineLatest([
    this.networkStatus.isOffline$,
    this.reconnectedVisible$,
    this.activity.isSlow$,
  ]).pipe(
    map(([offline, reconnected, slowOperation]) => ({
      offline,
      reconnected: !offline && reconnected,
      slowOperation,
    })),
    distinctUntilChanged(
      (previous, current) =>
        previous.offline === current.offline &&
        previous.reconnected === current.reconnected &&
        previous.slowOperation === current.slowOperation
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
