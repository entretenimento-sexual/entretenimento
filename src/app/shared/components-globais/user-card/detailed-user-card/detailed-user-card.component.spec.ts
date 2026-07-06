// src/app/shared/components-globais/user-card/detailed-user-card/detailed-user-card.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { DetailedUserCardComponent } from './detailed-user-card.component';

describe('DetailedUserCardComponent', () => {
  let fixture: ComponentFixture<DetailedUserCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DetailedUserCardComponent],
      providers: [
        {
          provide: Store,
          useValue: {
            select: vi.fn(() => of('viewer-uid')),
          },
        },
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DetailedUserCardComponent);
    fixture.componentRef.setInput('user', { uid: 'u1' } as any);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
