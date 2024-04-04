import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UserActivityFeedComponent } from './user-activity-feed.component';

describe('UserActivityFeedComponent', () => {
  let component: UserActivityFeedComponent;
  let fixture: ComponentFixture<UserActivityFeedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserActivityFeedComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(UserActivityFeedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
