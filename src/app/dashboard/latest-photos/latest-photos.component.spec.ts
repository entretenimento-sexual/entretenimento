import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LatestPhotosComponent } from './latest-photos.component';

describe('LatestPhotosComponent', () => {
  let component: LatestPhotosComponent;
  let fixture: ComponentFixture<LatestPhotosComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LatestPhotosComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(LatestPhotosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
