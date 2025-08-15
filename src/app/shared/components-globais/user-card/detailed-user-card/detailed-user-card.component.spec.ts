//src\app\shared\components-globais\user-card\detailed-user-card\detailed-user-card.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DetailedUserCardComponent } from './detailed-user-card.component';

describe('DetailedUserCardComponent', () => {
  let fixture: ComponentFixture<DetailedUserCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DetailedUserCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DetailedUserCardComponent);
    fixture.componentRef.setInput('user', { uid: 'u1' } as any);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
