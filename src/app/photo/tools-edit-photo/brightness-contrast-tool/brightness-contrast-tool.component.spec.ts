import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BrightnessContrastToolComponent } from './brightness-contrast-tool.component';

describe('BrightnessContrastToolComponent', () => {
  let component: BrightnessContrastToolComponent;
  let fixture: ComponentFixture<BrightnessContrastToolComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BrightnessContrastToolComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(BrightnessContrastToolComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
