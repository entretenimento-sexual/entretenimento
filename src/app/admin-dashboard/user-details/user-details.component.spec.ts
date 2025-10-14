// src/app/admin-dashboard/user-details/user-details.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { UserDetailsComponent } from './user-details.component';
import { UserManagementService } from '../../core/services/account-moderation/user-management.service'; // ajuste o path se preciso

describe('UserDetailsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserDetailsComponent],          // ✅ standalone entra aqui
      providers: [
        { provide: UserManagementService, useValue: { deleteUserAccount: () => of(void 0) } },
      ],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(UserDetailsComponent);
    const comp = fixture.componentInstance;
    expect(comp).toBeTruthy();
  });
});
