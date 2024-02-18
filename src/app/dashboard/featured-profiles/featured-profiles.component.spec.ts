import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FeaturedProfilesComponent } from './featured-profiles.component';

describe('FeaturedProfilesComponent', () => {
  let component: FeaturedProfilesComponent;
  let fixture: ComponentFixture<FeaturedProfilesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeaturedProfilesComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(FeaturedProfilesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
