//src\app\layout\other-user-profile-view\other-user-profile-view.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OtherUserProfileViewComponent } from './other-user-profile-view.component';

describe('OtherUserProfileViewComponent', () => {
  let component: OtherUserProfileViewComponent;
  let fixture: ComponentFixture<OtherUserProfileViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OtherUserProfileViewComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(OtherUserProfileViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
