import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EspiarComponent } from './espiar.component';

describe('EspiarComponent', () => {
  let component: EspiarComponent;
  let fixture: ComponentFixture<EspiarComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [EspiarComponent]
    });
    fixture = TestBed.createComponent(EspiarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
