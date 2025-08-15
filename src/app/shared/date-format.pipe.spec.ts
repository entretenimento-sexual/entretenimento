//src\app\shared\date-format.pipe.spec.ts
import { TestBed } from '@angular/core/testing';
import { DateFormatPipe } from './date-format.pipe';
import { DateTimeService } from '../core/services/general/date-time.service';

describe('DateFormatPipe', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        DateFormatPipe,
        { provide: DateTimeService, useValue: { format: (d: any) => '01/01/2025' } }
      ]
    });
  });

  it('should create', () => {
    const pipe = TestBed.inject(DateFormatPipe);
    expect(pipe).toBeTruthy();
  });
});
