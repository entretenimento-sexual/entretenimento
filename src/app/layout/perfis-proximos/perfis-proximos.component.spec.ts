import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PerfisProximosComponent } from './perfis-proximos.component';

describe('PerfisProximosComponent', () => {
  let component: PerfisProximosComponent;
  let fixture: ComponentFixture<PerfisProximosComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [PerfisProximosComponent]
    });
    fixture = TestBed.createComponent(PerfisProximosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
