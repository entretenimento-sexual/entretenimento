// src/app/photo-editor/photo-editor/photo-editor.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { PhotoEditorSessionService } from '../../core/services/image-handling/photo-editor-session.service';
import {
  createErrorTestingProviderMocks,
  provideErrorTestingMocks,
} from '../../../test/angular-error-testing.providers';
import { PhotoEditorComponent } from './photo-editor.component';

describe('PhotoEditorComponent', () => {
  let fixture: ComponentFixture<PhotoEditorComponent>;
  let component: PhotoEditorComponent;
  let uidSubject: Subject<string>;
  let activeModalMock: {
    close: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    uidSubject = new Subject<string>();
    activeModalMock = {
      close: vi.fn(),
      dismiss: vi.fn(),
    };

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:photo-editor-test'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    const errorProviderMocks = createErrorTestingProviderMocks();

    await TestBed.configureTestingModule({
      imports: [PhotoEditorComponent],
      providers: [
        {
          provide: NgbActiveModal,
          useValue: activeModalMock,
        },
        {
          provide: AuthSessionService,
          useValue: {
            uid$: uidSubject.asObservable(),
            currentAuthUser: { uid: 'u1' },
          },
        },
        {
          provide: PhotoEditorSessionService,
          useValue: {
            peekDraft: vi.fn(() => null),
            clearDraft: vi.fn(),
          },
        },
        ...provideErrorTestingMocks(errorProviderMocks),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PhotoEditorComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput(
      'imageFile',
      new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    );
    fixture.detectChanges();
    uidSubject.next('u1');
  });

  function markEditorIdle(): void {
    (component as any).isLoadingSubject.next(false);
    (component as any).isSavingSubject.next(false);
    (component as any).isClosingSubject.next(false);
  }

  it('deve ser criado', () => {
    expect(component).toBeTruthy();
  });

  it('deve definir userId a partir do AuthSessionService', () => {
    expect(component.userId).toBe('u1');
  });

  it('deve manter o arquivo recebido pelo contrato de input', () => {
    expect(component.imageFile()?.name).toBe('foto.jpg');
    expect(component.imageFile()?.type).toBe('image/jpeg');
  });

  it('deve iniciar em estado de carregamento enquanto prepara a imagem', async () => {
    await expect(firstValueFrom(component.isLoading$)).resolves.toBe(true);
  });

  it('deve iniciar com o estado nativo padrão do editor', () => {
    expect(component.rotation).toBe(0);
    expect(component.zoom).toBe(1);
    expect(component.panX).toBe(0);
    expect(component.panY).toBe(0);
    expect(component.aspectRatio).toBe('original');
    expect(component.activeTool).toBe('move');
    expect(component.overlays).toEqual([]);
    expect(component.selectedOverlay).toBeNull();
    expect(component.canUndo).toBe(false);
    expect(component.canRedo).toBe(false);
    expect(component.saveActionLabel).toBe('Aplicar edição');
  });

  it('bloqueia proporção conforme o preset canônico de avatar', () => {
    markEditorIdle();
    (component as any).activeDraft = {
      mode: 'create',
      source: 'profile-avatar',
      context: 'profile-avatar',
      preset: 'avatar-square',
      file: component.imageFile()!,
      ownerUid: 'u1',
      createdAt: Date.now(),
    };
    component.aspectRatio = 'square';

    expect(component.activePreset).toBe('avatar-square');
    expect(component.isAspectRatioLocked).toBe(true);
    expect(component.isAspectRatioOptionDisabled('landscape')).toBe(true);

    component.setAspectRatio('landscape');
    expect(component.aspectRatio).toBe('square');

    component.aspectRatio = 'original';
    component.resetEditor();
    expect(component.aspectRatio).toBe('square');
  });

  it('deve expor catálogos ampliados de ferramentas, emojis e fontes', () => {
    expect(component.toolOptions.map((tool) => tool.value)).toEqual([
      'move',
      'blur',
      'pixelate',
      'emoji',
      'text',
      'datetime',
    ]);
    expect(component.emojiOptions.length).toBeGreaterThanOrEqual(24);
    expect(component.emojiOptions).toContain('🔒');
    expect(component.fontOptions.map((font) => font.value)).toEqual([
      'system',
      'rounded',
      'serif',
      'condensed',
      'handwritten',
      'mono',
    ]);
  });

  it('deve limitar intensidade e tamanho aos intervalos suportados', () => {
    component.updatePrivacyStrength(99);
    component.updateDecorationSize(99);

    expect(component.privacyStrength).toBe(8);
    expect(component.decorationSize).toBe(28);
  });

  it('deve selecionar, editar, duplicar e remover um texto', () => {
    markEditorIdle();
    component.overlays = [
      {
        id: 'text-1',
        kind: 'text',
        x: 0.5,
        y: 0.5,
        size: 0.1,
        value: 'Texto inicial',
        style: 'classic',
        fontFamily: 'system',
      },
    ];
    (component as any).resetOverlayHistory(component.overlays);

    component.selectOverlay('text-1');
    component.updateSelectedText('Texto editado');
    component.updateSelectedFontFamily('condensed');
    component.commitSelectedOverlayEdit();

    expect(component.selectedOverlay).toMatchObject({
      id: 'text-1',
      value: 'Texto editado',
      fontFamily: 'condensed',
    });

    component.duplicateSelectedOverlay();
    expect(component.overlays).toHaveLength(2);
    expect(component.selectedOverlay?.id).not.toBe('text-1');

    component.removeSelectedOverlay();
    expect(component.overlays).toHaveLength(1);
    expect(component.selectedOverlay).toBeNull();
  });

  it('deve permitir editar data, hora, formato e ano', () => {
    markEditorIdle();
    component.overlays = [
      {
        id: 'datetime-1',
        kind: 'datetime',
        x: 0.5,
        y: 0.5,
        size: 0.1,
        value: '13 JUL • 15:42',
        style: 'badge',
        fontFamily: 'rounded',
        dateTimeMeta: {
          date: '2026-07-13',
          time: '15:42',
          format: 'instagram',
          includeYear: false,
        },
      },
    ];
    (component as any).resetOverlayHistory(component.overlays);
    component.selectOverlay('datetime-1');

    component.updateSelectedDateTimeDate('2026-08-20');
    component.updateSelectedDateTimeTime('09:30');
    component.updateSelectedDateTimeFormat('numeric');
    component.updateSelectedDateTimeIncludeYear(true);
    component.commitSelectedOverlayEdit();

    expect(component.selectedDateTimeMeta).toEqual({
      date: '2026-08-20',
      time: '09:30',
      format: 'numeric',
      includeYear: true,
    });
    expect(component.selectedOverlay).toMatchObject({
      value: '20/08/2026 • 09:30',
    });
  });

  it('desfaz e refaz transformações e overlays no mesmo histórico canônico', () => {
    markEditorIdle();
    (component as any).resetOverlayHistory([]);

    component.rotateRight();
    component.updateZoom(1.5);
    (component as any).commitOverlays([
      {
        id: 'text-history',
        kind: 'text',
        x: 0.5,
        y: 0.5,
        size: 0.1,
        value: 'Histórico',
        style: 'classic',
        fontFamily: 'system',
      },
    ]);

    expect(component.rotation).toBe(90);
    expect(component.zoom).toBe(1.5);
    expect(component.overlays).toHaveLength(1);
    expect(component.canUndo).toBe(true);

    component.undoOverlay();
    expect(component.overlays).toEqual([]);
    expect(component.zoom).toBe(1.5);
    expect(component.rotation).toBe(90);

    component.undoOverlay();
    expect(component.zoom).toBe(1);
    expect(component.rotation).toBe(90);

    component.undoOverlay();
    expect(component.rotation).toBe(0);
    expect(component.canUndo).toBe(false);

    component.redoOverlay();
    component.redoOverlay();
    component.redoOverlay();
    expect(component.rotation).toBe(90);
    expect(component.zoom).toBe(1.5);
    expect(component.overlays).toHaveLength(1);
    expect(component.canRedo).toBe(false);
  });

  it('descarta redo quando uma nova edição nasce depois de undo', () => {
    markEditorIdle();
    (component as any).resetOverlayHistory([]);

    component.rotateRight();
    component.rotateRight();
    component.undoOverlay();

    expect(component.rotation).toBe(90);
    expect(component.canRedo).toBe(true);

    component.setAspectRatio('square');

    expect(component.aspectRatio).toBe('square');
    expect(component.canRedo).toBe(false);
  });

  it('usa Ctrl/Cmd+Z e Ctrl/Cmd+Shift+Z no histórico completo', () => {
    markEditorIdle();
    (component as any).resetOverlayHistory([]);
    component.rotateRight();

    component.onCanvasKeydown(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })
    );
    expect(component.rotation).toBe(0);

    component.onCanvasKeydown(
      new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        shiftKey: true,
      })
    );
    expect(component.rotation).toBe(90);
  });

  it('deve devolver resultado processado sem persistir mídia', async () => {
    markEditorIdle();
    const sourceFile = component.imageFile()!;
    (component as any).sourceFile = sourceFile;
    (component as any).sourceImage = { naturalWidth: 640, naturalHeight: 480 };
    vi.spyOn(component as any, 'exportImage').mockResolvedValue({
      blob: new Blob(['editada'], { type: 'image/jpeg' }),
      width: 1280,
      height: 960,
    });

    await component.save();

    expect(activeModalMock.close).toHaveBeenCalledTimes(1);
    const payload = activeModalMock.close.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({
      reason: 'processSuccess',
      result: expect.objectContaining({
        kind: 'image',
        width: 1280,
        height: 960,
        context: 'generic',
        preset: 'free',
        metadataStripped: true,
      }),
    }));
    expect(payload.result.file).toEqual(expect.objectContaining({
      name: 'foto-editada.jpg',
      type: 'image/jpeg',
    }));
  });

  it('deve fechar o modal pelo contrato atual', () => {
    component.onClose();

    expect(activeModalMock.dismiss).toHaveBeenCalledWith('close');
  });
});
