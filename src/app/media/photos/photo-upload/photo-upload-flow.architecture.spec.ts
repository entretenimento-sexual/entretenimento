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
    expect(component).toContain("type PhotoUploadAudience = 'PRIVATE' | TPhotoPublishableVisibility");
    expect(component).toContain("if (!audience)");
    expect(component).toContain("if (audience === 'PRIVATE')");
    expect(component).toContain('visibility: audience');
  });

  it('preserva a cópia privada quando a publicação falha', () => {
    const component = source(
      'src/app/media/photos/photo-upload/photo-upload.component.ts'
    );

    expect(component).toContain('privateCopyPreserved: true');
    expect(component).toContain(
      'A foto foi salva na sua biblioteca privada, mas não foi publicada.'
    );
    expect(component).not.toContain('rollbackFailedPublication');
  });

  it('seleção global de foto não abre o editor automaticamente', () => {
    const globalUpload = source(
      'src/app/shared/components-globais/upload-photo/upload-photo.component.ts'
    );

    expect(globalUpload).not.toContain('.editFile$(');
    expect(globalUpload).toContain('this.photoSelected.emit(selectedFile)');
  });

  it('a UI exige uma decisão visível de audiência', () => {
    const template = source(
      'src/app/media/photos/photo-upload/photo-upload.component.html'
    );

    expect(template).toContain('Quem poderá ver esta foto?');
    expect(template).toContain("selectAudience('PRIVATE')");
    expect(template).toContain("selectAudience('FRIENDS')");
    expect(template).toContain("selectAudience('PUBLIC')");
    expect(template).toContain("[disabled]="phase !== 'READY' || !audience"");
  });
});
