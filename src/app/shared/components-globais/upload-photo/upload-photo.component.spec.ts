//src\app\shared\components-globais\upload-photo\upload-photo.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { UploadPhotoComponent } from './upload-photo.component';

describe('UploadPhotoComponent', () => {
  let fixture: ComponentFixture<UploadPhotoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [UploadPhotoComponent],
      providers: [{ provide: NgbActiveModal, useValue: { close: () => { }, dismiss: () => { } } }],
    }).compileComponents();

    fixture = TestBed.createComponent(UploadPhotoComponent);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
