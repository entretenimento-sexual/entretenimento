//src\app\shared\components-globais\user-card\base-user-card\base-user-card.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BaseUserCardComponent } from './base-user-card.component';

describe('BaseUserCardComponent', () => {
  let fixture: ComponentFixture<BaseUserCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BaseUserCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BaseUserCardComponent);
    fixture.componentRef.setInput('user', { uid: 'u1' } as any);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
