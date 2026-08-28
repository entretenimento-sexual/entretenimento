//src\app\shared\components-globais\user-card\modal-user-card\modal-user-card.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalUserCardComponent } from './modal-user-card.component';

describe('ModalUserCardComponent', () => {
  let fixture: ComponentFixture<ModalUserCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModalUserCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ModalUserCardComponent);
    fixture.componentRef.setInput('user', { uid: 'u1' } as any);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
