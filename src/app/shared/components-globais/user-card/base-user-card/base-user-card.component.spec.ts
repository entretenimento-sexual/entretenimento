import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BaseUserCardComponent } from './base-user-card.component';

describe('BaseUserCardComponent', () => {
  let component: BaseUserCardComponent;
  let fixture: ComponentFixture<BaseUserCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BaseUserCardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BaseUserCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
