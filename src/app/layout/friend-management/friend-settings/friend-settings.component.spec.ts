import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FriendSettingsComponent } from './friend-settings.component';

describe('FriendSettingsComponent', () => {
  let component: FriendSettingsComponent;
  let fixture: ComponentFixture<FriendSettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FriendSettingsComponent]
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
