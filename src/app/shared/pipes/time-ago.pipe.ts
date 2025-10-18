//src\app\shared\pipes\time-ago.pipe.ts
import { ChangeDetectorRef, NgZone, OnDestroy, Pipe, PipeTransform } from '@angular/core';
import { DateTimeService } from 'src/app/core/services/general/date-time.service';

@Pipe({ name: 'timeAgo', standalone: true, pure: false })
export class TimeAgoPipe implements PipeTransform, OnDestroy {
  private timer: any;

  constructor(private cdr: ChangeDetectorRef, private zone: NgZone, private dt: DateTimeService) { }

  transform(value: any): string {
    const text = this.dt.calculateElapsedTime(value);
    this.clearTimer();

    // agenda a próxima atualização (a cada 60s)
    this.zone.runOutsideAngular(() => {
      this.timer = setTimeout(() => {
        this.zone.run(() => this.cdr.markForCheck());
      }, 60_000);
    });

    return text;
  }

  ngOnDestroy() { this.clearTimer(); }
  private clearTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
}
