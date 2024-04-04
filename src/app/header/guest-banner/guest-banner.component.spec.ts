import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GuestBannerComponent } from './guest-banner.component';

describe('GuestBannerComponent', () => {
  let component: GuestBannerComponent;
  let fixture: ComponentFixture<GuestBannerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [GuestBannerComponent]
    });
    fixture = TestBed.createComponent(GuestBannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
