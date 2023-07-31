import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CopyrightFooterComponent } from './copyright-footer.component';

describe('CopyrightFooterComponent', () => {
  let component: CopyrightFooterComponent;
  let fixture: ComponentFixture<CopyrightFooterComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [CopyrightFooterComponent]
    });
    fixture = TestBed.createComponent(CopyrightFooterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
