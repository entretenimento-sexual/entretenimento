import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CompactUserCardComponent } from './compact-user-card.component';

describe('CompactUserCardComponent', () => {
  let component: CompactUserCardComponent;
  let fixture: ComponentFixture<CompactUserCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompactUserCardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CompactUserCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
