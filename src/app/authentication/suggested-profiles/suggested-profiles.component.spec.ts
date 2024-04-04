import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SuggestedProfilesComponent } from './suggested-profiles.component';

describe('SuggestedProfilesComponent', () => {
  let component: SuggestedProfilesComponent;
  let fixture: ComponentFixture<SuggestedProfilesComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SuggestedProfilesComponent]
    });
    fixture = TestBed.createComponent(SuggestedProfilesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
