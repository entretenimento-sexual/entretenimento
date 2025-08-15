//src\app\admin-dashboard\user-details\user-details.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { UserDetailsComponent } from './user-details.component';
import { UserManagementService } from '../../core/services/account-moderation/user-management.service';
import { UserModerationService } from '../../core/services/account-moderation/user-moderation.service';

describe('UserDetailsComponent', () => {
  let component: UserDetailsComponent;
  let fixture: ComponentFixture<UserDetailsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [UserDetailsComponent],
      providers: [
        { provide: UserManagementService, useValue: { deleteUserAccount: () => of(void 0) } },
        { provide: UserModerationService, useValue: { suspendUser: () => of(void 0), unsuspendUser: () => of(void 0) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserDetailsComponent);
    // evita NG0950 se o template usa user
    fixture.componentRef.setInput('user', { uid: 'u1' });
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
