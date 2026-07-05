// src/app/shared/user-card/user-card.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { MatDialog } from '@angular/material/dialog';
import { vi } from 'vitest';

import { UserCardComponent } from './user-card.component';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import {
  createStoreTestingMock,
  provideStoreTestingMock,
  StoreTestingMock,
} from '../../../test/ngrx-store-testing.providers';

describe('UserCardComponent', () => {
  let fixture: ComponentFixture<UserCardComponent>;
  let storeMock: StoreTestingMock;

  beforeEach(async () => {
    storeMock = createStoreTestingMock();

    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule,
        UserCardComponent,
      ],
      providers: [
        ...provideStoreTestingMock(storeMock),
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showInfo: vi.fn(),
            showError: vi.fn(),
            showSuccess: vi.fn(),
            showWarning: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserCardComponent);
    fixture.componentRef.setInput('user', { uid: 'u1' } as any);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
