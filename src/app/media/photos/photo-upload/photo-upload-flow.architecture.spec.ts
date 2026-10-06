import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('photo upload flow architecture', () => {
  it('não publica foto automaticamente como PUBLIC', () => {
    const component = source(
      'src/app/media/photos/photo-upload/photo-upload.component.ts'
    );

    expect(component).not.toContain("visibility: 'PUBLIC'");
    expect(component).toContain('type PhotoUploadAudience = TPhotoPublishableVisibility');
    expect(component).toContain('if (!audience)');
    expect(component).toContain('visibility: audience');
    expect(component).not.toContain("'PRIVATE'");
  });

  it('remove o upload de origem quando a publicação falha', () => {
    const component = source(
      'src/app/media/photos/photo-upload/photo-upload.component.ts'
    );

    expect(component).toContain('rollbackFailedPublication');
    expect(component).toContain('this.photoFirestore.deletePhoto');
    expect(component).not.toContain('privateCopyPreserved');
    expect(component).not.toContain('biblioteca privada');
  });

  it('seleção global de foto não abre o editor automaticamente', () => {
    const globalUpload = source(
      'src/app/shared/components-globais/upload-photo/upload-photo.component.ts'
    );

    expect(globalUpload).not.toContain('.editFile$(');
    expect(globalUpload).toContain('this.photoSelected.emit(selectedFile)');
  });

  it('o editor só abre por gesto explícito no botão de edição', () => {
    const component = source(
      'src/app/media/photos/photo-upload/photo-upload.component.ts'
    );
    const template = source(
      'src/app/media/photos/photo-upload/photo-upload.component.html'
    );

    const selectionStart = component.indexOf('  onFileSelected(');
    const uploadStart = component.indexOf('  startUpload(', selectionStart);
    const selectionBlock = component.slice(selectionStart, uploadStart);

    expect(selectionStart).toBeGreaterThanOrEqual(0);
    expect(uploadStart).toBeGreaterThan(selectionStart);
    expect(selectionBlock).not.toContain('photoEditor.editFile$(');
    expect(selectionBlock).not.toContain('editBeforeUpload(');

    expect(template).toContain('(click)="editBeforeUpload($event)"');
    expect(component).toContain('editBeforeUpload(event: MouseEvent)');
    expect(component).toContain('if (!event.isTrusted)');
  });

  it('a UI exige uma decisão visível de audiência', () => {
    const template = source(
      'src/app/media/photos/photo-upload/photo-upload.component.html'
    );

    expect(template).toContain('Quem poderá ver esta foto?');
    expect(template).not.toContain("selectAudience('PRIVATE')");
    expect(template).toContain("selectAudience('FRIENDS')");
    expect(template).toContain("selectAudience('PUBLIC')");
    expect(template).toContain(`[disabled]="phase !== 'READY' || !audience"`);
  });
});
