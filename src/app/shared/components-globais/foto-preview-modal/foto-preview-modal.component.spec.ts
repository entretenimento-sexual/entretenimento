import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FotoPreviewModalComponent } from './foto-preview-modal.component';

describe('FotoPreviewModalComponent', () => {
  let component: FotoPreviewModalComponent;
  let fixture: ComponentFixture<FotoPreviewModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FotoPreviewModalComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(FotoPreviewModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
