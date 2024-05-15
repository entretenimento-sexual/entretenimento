import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FaceBlurToolComponent } from './face-blur-tool.component';

describe('FaceBlurToolComponent', () => {
  let component: FaceBlurToolComponent;
  let fixture: ComponentFixture<FaceBlurToolComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FaceBlurToolComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(FaceBlurToolComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
