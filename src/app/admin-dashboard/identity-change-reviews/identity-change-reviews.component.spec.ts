import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { IdentityChangeReviewsComponent } from './identity-change-reviews.component';
import { IdentityReviewRepository } from './identity-review.repository';

const normal = {
  uid: 'u1', currentIdentityCode: 'mulher', requestedIdentityCode: 'homem',
  requestedAt: 1760000000000, status: 'PENDING' as const,
  structuralChange: false,
};
const structural = {
  uid: 'u2', currentIdentityCode: 'homem', requestedIdentityCode: 'casal-ele-ela',
  requestedAt: 1760000000001, status: 'PENDING' as const,
  structuralChange: true,
};

describe('IdentityChangeReviewsComponent', () => {
  let fixture: ComponentFixture<IdentityChangeReviewsComponent>;
  let repo: { getPage$: ReturnType<typeof vi.fn>; review$: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    repo = {
      getPage$: vi.fn(() => of({ items: [normal, structural], nextCursor: null })),
      review$: vi.fn(() => of('APPROVED')),
    };
    await TestBed.configureTestingModule({
      imports: [IdentityChangeReviewsComponent],
      providers: [
        provideRouter([]),
        { provide: IdentityReviewRepository, useValue: repo },
        { provide: ErrorNotificationService,
          useValue: { showSuccess: vi.fn(), showWarning: vi.fn() } },
        { provide: ApplicationErrorService, useValue: { report: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(IdentityChangeReviewsComponent);
    fixture.detectChanges();
  });

  it('exibe fila sem dados privados e não permite aprovação estrutural', () => {
    expect(fixture.nativeElement.textContent).toContain('Solicitação u1');
    expect(fixture.nativeElement.textContent).toContain('Solicitação u2');
    expect(fixture.nativeElement.textContent).toContain('consentimento próprios');
    const cards = fixture.nativeElement.querySelectorAll('.identity-reviews__card');
    const approve = cards[1].querySelector('button');
    expect(approve?.disabled).toBe(true);
    fixture.componentInstance.beginReview(structural, 'APPROVE');
    expect(fixture.componentInstance.selected).toBeNull();
    expect(repo.review$).not.toHaveBeenCalled();
  });

  it('exige justificativa e atualiza a fila depois de uma revisão', () => {
    const component = fixture.componentInstance;
    component.beginReview(normal, 'APPROVE');
    component.reviewForm.controls.resolution.setValue('Revisão confirmada após verificação.');
    component.confirmReview();
    expect(repo.review$).toHaveBeenCalledWith(
      'u1', 'APPROVE', 'Revisão confirmada após verificação.'
    );
    expect(component.selected).toBeNull();
    expect(repo.getPage$).toHaveBeenCalledTimes(2);
  });
});
