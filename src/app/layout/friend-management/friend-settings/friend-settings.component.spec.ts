import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { FriendSettingsComponent } from './friend-settings.component';
import { CacheService } from '../../../core/services/general/cache/cache.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';

describe('FriendSettingsComponent', () => {
  let component: FriendSettingsComponent;
  let fixture: ComponentFixture<FriendSettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FriendSettingsComponent],
      providers: [
        provideMockStore({ initialState: {} }),
        { provide: CacheService, useValue: { get: vi.fn(() => of(null)), set: vi.fn() } },
        { provide: ErrorNotificationService, useValue: { showSuccess: vi.fn(), showError: vi.fn() } },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(FriendSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
