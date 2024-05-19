// src/app/photo/photo-editor/photo-editor.component.ts
import { Component, Inject, OnInit, ViewChild, ElementRef } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { fabric } from 'fabric';
import { CanvasHistoryService } from '../services-photo/canvas-history.service';

@Component({
  selector: 'app-photo-editor',
  templateUrl: './photo-editor.component.html',
  styleUrls: ['./photo-editor.component.css']
})
export class PhotoEditorComponent implements OnInit {
  @ViewChild('photoContainer') photoContainer!: ElementRef;
  private canvas?: fabric.Canvas;
  private image?: fabric.Image;
  private cropRect?: fabric.Rect;
  private blurGroup = new fabric.Group([], { selectable: false, evented: false });
  isBrushActive: boolean = false;
  private blurIntensity: number = 5;
  activeTool: string = 'none';

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: any,
    private dialogRef: MatDialogRef<PhotoEditorComponent>,
    private canvasHistoryService: CanvasHistoryService
  ) { }

  ngOnInit(): void { }

  ngAfterViewInit(): void {
    this.initializeCanvas();
    this.loadImage(this.data.file);
  }

  private initializeCanvas(): void {
    const container = this.photoContainer.nativeElement;
    this.canvas = new fabric.Canvas('canvasID', {
      width: container.clientWidth,
      height: container.clientHeight,
      backgroundColor: 'white',
    });
    this.canvas.add(this.blurGroup);
    this.canvas.on('object:modified', () => this.saveState());
  }

  private loadImage(imageUrl: string): void {
    fabric.Image.fromURL(imageUrl, (img) => {
      if (!this.canvas) return;

      this.image = img;
      this.image.set({
        scaleX: 1,
        scaleY: 1,
        left: 0,
        top: 0,
        selectable: false,
        evented: false
      });
      this.canvas.setWidth(img.width || this.canvas.getWidth());
      this.canvas.setHeight(img.height || this.canvas.getHeight());
      this.canvas.add(img);
      this.canvas.centerObject(img);
      this.canvas.renderAll();
      this.saveState(); // Salva o estado inicial
    }, { crossOrigin: 'anonymous' });
  }

  activateBlurBrush(): void {
    if (!this.canvas) return;

    this.setActiveTool('blurBrush');
    const brush = new fabric.PencilBrush(this.canvas);
    brush.color = `rgba(255,255,255,${this.blurIntensity / 10})`;
    brush.width = 15;
    this.canvas.freeDrawingBrush = brush;
    this.canvas.isDrawingMode = true;
    this.canvas.on('path:created', (event) => {
      const path = event.target;
      if (path && path instanceof fabric.Path) {
        path.selectable = false;
        this.blurGroup.addWithUpdate(path);
        this.applyBlurEffect(path);
        this.saveState(); // Salva o estado após desenhar
        if (this.canvas) this.canvas.renderAll();
      }
    });
  }

  changeBrushColor(color: string): void {
    if (this.canvas && this.canvas.isDrawingMode) {
      const brush = this.canvas.freeDrawingBrush;
      brush.color = color;
    }
  }

  toggleBrush(): void {
    if (!this.canvas) return;
    this.isBrushActive = !this.isBrushActive;
    this.canvas.isDrawingMode = this.isBrushActive;
    this.setActiveTool(this.isBrushActive ? 'brush' : 'none');
  }

  private enableBlurBrush(intensity: number = 5): void {
    if (!this.canvas) return;

    this.setActiveTool('blurBrush');
    this.canvas.isDrawingMode = true;
    const brush = new fabric.PencilBrush(this.canvas);
    brush.color = `rgba(255,255,255,${intensity / 10})`;
    brush.width = 15;
    this.canvas.freeDrawingBrush = brush;

    this.canvas.on('path:created', (event) => {
      const path = event.target;
      if (path && path instanceof fabric.Path) {
        path.selectable = false;
        this.blurGroup.addWithUpdate(path);
        this.applyBlurEffect(path);
        this.saveState(); // Salva o estado após desenhar
        if (this.canvas) this.canvas.renderAll();
      }
    });
  }

  private applyBlurEffect(path: fabric.Path): void {
    const context = this.canvas?.getContext();
    if (context) {
      const { left = 0, top = 0, width = 0, height = 0 } = path.getBoundingRect() ?? {};
      context.save();
      context.filter = `blur(${this.blurIntensity}px)`;
      context.drawImage(
        this.canvas?.getElement() ?? new Image(),
        left, top, width, height,
        left, top, width, height
      );
      context.filter = 'none';
      context.restore();
    }
  }

  applyBlurSettings(settings: { active: boolean, intensity: number }) {
    if (settings.active) {
      this.blurIntensity = settings.intensity;
      this.enableBlurBrush(this.blurIntensity);
    }
  }

  setActiveTool(tool: string): void {
    this.activeTool = tool;
  }

  saveState(): void {
    if (this.canvas) {
      this.canvasHistoryService.addToHistory(this.canvas.toDataURL());
    }
  }

  undo(): void {
    const state = this.canvasHistoryService.undo();
    if (state && this.canvas) {
      fabric.Image.fromURL(state, (img) => {
        if (!this.canvas) return;
        this.canvas.clear();
        this.canvas.add(img);
        this.canvas.renderAll();
      });
    }
  }

  redo(): void {
    const state = this.canvasHistoryService.redo();
    if (state && this.canvas) {
      fabric.Image.fromURL(state, (img) => {
        if (!this.canvas) return;
        this.canvas.clear();
        this.canvas.add(img);
        this.canvas.renderAll();
      });
    }
  }

  // Métodos de corte
  startCrop(): void {
    if (!this.canvas || !this.image) return;

    this.cropRect = new fabric.Rect({
      left: 50,
      top: 50,
      width: 200,
      height: 200,
      fill: 'rgba(0,0,0,0.3)',
      selectable: true,
      evented: true
    });

    this.canvas.add(this.cropRect);
    this.canvas.setActiveObject(this.cropRect);
    this.canvas.renderAll();
  }

  applyCrop(): void {
    if (!this.canvas || !this.image || !this.cropRect) return;

    const crop = this.cropRect.getBoundingRect();

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = crop.width;
    croppedCanvas.height = crop.height;
    const croppedCtx = croppedCanvas.getContext('2d');

    if (!croppedCtx || !this.image) return;

    croppedCtx.drawImage(
      this.image.getElement(),
      crop.left, crop.top, crop.width, crop.height,
      0, 0, crop.width, crop.height
    );

    const croppedImg = new Image();
    croppedImg.src = croppedCanvas.toDataURL();

    croppedImg.onload = () => {
      const croppedFabricImg = new fabric.Image(croppedImg, {
        left: 0,
        top: 0,
      });

      if (this.canvas) {
        this.canvas.clear();
        this.canvas.setWidth(crop.width);
        this.canvas.setHeight(crop.height);
        this.canvas.add(croppedFabricImg);
        this.image = croppedFabricImg;
        this.cropRect = undefined;
        this.canvas.renderAll();
        this.saveState(); // Salva o estado após o corte
      }
    };
  }

  cancelCrop(): void {
    if (!this.canvas || !this.cropRect) return;

    this.canvas.remove(this.cropRect);
    this.cropRect = undefined;
    this.canvas.renderAll();
  }

  concludeAndClose(): void {
    if (!this.canvas || !this.image) {
      console.error("Canvas ou imagem não estão definidos.");
      return;
    }
    this.canvas.isDrawingMode = false;

    const imageURL = this.canvas.toDataURL({
      format: 'png',
      quality: 1,
      width: this.image.width,
      height: this.image.height
    });

    this.dialogRef.close({
      imageURL: imageURL
    });
  }
}
