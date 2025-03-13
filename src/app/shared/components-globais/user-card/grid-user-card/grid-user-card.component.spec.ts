import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GridUserCardComponent } from './grid-user-card.component';

describe('GridUserCardComponent', () => {
  let component: GridUserCardComponent;
  let fixture: ComponentFixture<GridUserCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GridUserCardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GridUserCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
