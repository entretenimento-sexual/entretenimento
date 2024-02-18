import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TextoDialogComponent } from './texto-dialog.component';

describe('TextoDialogComponent', () => {
  let component: TextoDialogComponent;
  let fixture: ComponentFixture<TextoDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TextoDialogComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(TextoDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
