// src/app/layout/perfis-proximos/perfis-proximos.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PerfisProximosComponent } from './perfis-proximos.component';

import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

describe('PerfisProximosComponent', () => {
  let component: PerfisProximosComponent;
  let fixture: ComponentFixture<PerfisProximosComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        PerfisProximosComponent, // standalone vai em imports
        RouterTestingModule,
        NoopAnimationsModule,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PerfisProximosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
