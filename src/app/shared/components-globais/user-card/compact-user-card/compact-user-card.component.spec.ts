//src\app\shared\components-globais\user-card\compact-user-card\compact-user-card.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CompactUserCardComponent } from './compact-user-card.component';

describe('CompactUserCardComponent', () => {
  let fixture: ComponentFixture<CompactUserCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompactUserCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CompactUserCardComponent);
    fixture.componentRef.setInput('user', { uid: 'u1', nickname: 'Nick' } as any);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
