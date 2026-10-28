import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function file(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('publicação social de mídias capturadas pela câmera', () => {
  it('captura foto no dispositivo e encaminha ao preview, nunca ao upload automático', () => {
    const template = file('src/app/media/photos/photo-upload/photo-upload.component.html');
    const component = file('src/app/media/photos/photo-upload/photo-upload.component.ts');

    expect(template).toContain('capture="environment"');
    expect(template).toContain('accept="image/*"');
    expect(template.match(/\(change\)="onFileSelected\(\$event\)"/g)?.length).toBe(2);
    expect(template).not.toContain('(change)="startUpload()"');
    expect(template).toContain('Tirar foto com a câmera');
    expect(template).toContain("selectAudience('FRIENDS')");
    expect(template).toContain("selectAudience('PUBLIC')");
    expect(component).toContain('this.applySelectedFile(file, null);');
    expect(component).toContain('if (!audience)');
    expect(component).toContain('validateImageMediaFile(file');
    expect(component).toContain('visibility: audience');
  });

  it('captura vídeo no dispositivo com o mesmo editor e publicação manual', () => {
    const template = file('src/app/media/videos/profile-videos/profile-videos.component.html');
    const component = file('src/app/media/videos/profile-videos/profile-videos.component.ts');
    const flow = file('src/app/core/services/media/video-upload-flow.service.ts');

    expect(template.match(/capture="environment"/g)?.length).toBe(2);
    expect(template.match(/accept="video\/\*"/g)?.length).toBe(2);
    expect(template.match(/\(change\)="onVideoSelected\(\$event\)"/g)?.length).toBe(3);
    expect(template).not.toContain('(change)="startUpload()"');
    expect(template).toContain('Gravar vídeo com a câmera');
    expect(template).toContain('(ngSubmit)="startUpload()"');
    expect(component).toContain('this.videoEditor.launchFile$(file');
    expect(component).toContain('this.selectedFileSubject.next(file)');
    expect(component).toContain("input.value = '';");
    expect(flow).toContain('this.validateFile(file)');
    expect(flow).toContain('publishWhenReady: true');
  });

  it('diretrizes em ambos os módulos proíbem captura como biblioteca privada', () => {
    const photoDirections = file('src/app/media/photos/DIRETRIZES-MIDIAS-PUBLICADAS.md');
    const photoAgent = file('src/app/media/photos/AGENTS.md');
    const videoAgent = file('src/app/media/videos/AGENTS.md');

    expect(photoDirections).toContain('## 2.1. Captura direta pela câmera');
    expect(photoDirections).toContain('Nunca');
    expect(photoDirections).toContain('retenc');
    expect(photoAgent).toContain('DIRETRIZES-MIDIAS-PUBLICADAS.md');
    expect(videoAgent).toContain('../photos/DIRETRIZES-MIDIAS-PUBLICADAS.md');
    expect(videoAgent).toContain('Capturar não é publicar.');
  });
});
