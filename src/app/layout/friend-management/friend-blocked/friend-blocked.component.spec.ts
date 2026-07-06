// src/app/layout/friend-management/friend-blocked/friend-blocked.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { FriendBlockedComponent } from './friend-blocked.component';

describe('FriendBlockedComponent', () => {
  let component: FriendBlockedComponent;
  let fixture: ComponentFixture<FriendBlockedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FriendBlockedComponent],
      providers: [
        { provide: Firestore, useValue: {} },
        {
          provide: Store,
          useValue: {
            dispatch: vi.fn(),
            select: vi.fn(() => of([])),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FriendBlockedComponent);
    fixture.componentRef.setInput('user', { uid: 'u1', nickname: 'Tester' } as any);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
