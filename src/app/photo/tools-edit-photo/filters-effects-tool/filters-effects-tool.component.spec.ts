import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FiltersEffectsToolComponent } from './filters-effects-tool.component';

describe('FiltersEffectsToolComponent', () => {
  let component: FiltersEffectsToolComponent;
  let fixture: ComponentFixture<FiltersEffectsToolComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FiltersEffectsToolComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(FiltersEffectsToolComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
