import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { FriendSearchComponent } from './friend-search.component';
import { CacheService } from '../../../core/services/general/cache/cache.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { FriendshipService } from '../../../core/services/interactions/friendship/friendship.service';

describe('FriendSearchComponent', () => {
  let component: FriendSearchComponent;
  let fixture: ComponentFixture<FriendSearchComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FriendSearchComponent],
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: FriendshipService, useValue: {} },
        {
          provide: Store,
          useValue: {
            dispatch: vi.fn(),
            select: vi.fn(() => of([])),
          },
        },
        {
          provide: CacheService,
          useValue: {
            get: vi.fn(() => of(null)),
            set: vi.fn(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
          },
        },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(FriendSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
