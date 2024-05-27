// src\app\photo\photo-editor\photo-editor.component.ts
import { Component, Inject, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { fabric } from 'fabric';
import { CanvasHistoryService } from '../services-photo/canvas-history.service';
import { PhotoErrorHandlerService } from '../services-photo/photo-error-handler.service';

@Component({
  selector: 'app-photo-editor',
  templateUrl: './photo-editor.component.html',
  styleUrls: ['./photo-editor.component.css']
})
export class PhotoEditorComponent implements OnInit, AfterViewInit {
  @ViewChild('photoContainer') photoContainer!: ElementRef;
  private canvas?: fabric.Canvas;
  private image?: fabric.Image;
  private cropRect?: fabric.Rect;
  private blurGroup = new fabric.Group([], { selectable: false, evented: false });
  isBrushActive: boolean = false;
  private blurIntensity: number = 10;
  activeTool: string = 'none';

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: any,
    private dialogRef: MatDialogRef<PhotoEditorComponent>,
    private canvasHistoryService: CanvasHistoryService,
    private errorHandler: PhotoErrorHandlerService
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
        left: 0,
        top: 0,
        selectable: false,
        evented: false
      });

      const containerWidth = this.canvas.getWidth();
      const containerHeight = this.canvas.getHeight();
      const scaleX = containerWidth / img.width!;
      const scaleY = containerHeight / img.height!;
      const scale = Math.min(scaleX, scaleY);

      if (scale < 1) {
        this.image.set({ scaleX: scale, scaleY: scale });
      }

      this.canvas.setWidth(img.width! * img.scaleX!);
      this.canvas.setHeight(img.height! * img.scaleY!);
      this.canvas.add(img);
      this.canvas.centerObject(img);
      this.canvas.renderAll();
      this.saveState();
    }, { crossOrigin: 'anonymous' });
  }

  private deactivateAllTools(): void {
    this.isBrushActive = false;
    if (this.canvas) {
      this.canvas.isDrawingMode = false;
      this.canvas.defaultCursor = 'default';
    }
    this.setActiveTool('none');
  }

  activateBlurBrush(): void {
    if (!this.canvas) return;

    this.deactivateAllTools();
    this.setActiveTool('blurBrush');
    const brush = new fabric.PencilBrush(this.canvas);
    brush.color = `rgba(255,255,255,0.3)`;
    brush.width = 15;
    this.canvas.freeDrawingBrush = brush;
    this.canvas.isDrawingMode = true;
    this.canvas.defaultCursor = 'url(assets/blur-cursor.png) 2 2, auto';
    this.canvas.on('path:created', (event) => {
      const path = event.target as fabric.Path;
      if (path) {
        path.selectable = false;
        this.blurGroup.addWithUpdate(path);
        this.applyBlurEffect(path);
        this.saveState();
        this.canvas?.renderAll();
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
    this.deactivateAllTools();
    this.isBrushActive = !this.isBrushActive;
    this.canvas.isDrawingMode = this.isBrushActive;
    this.setActiveTool(this.isBrushActive ? 'brush' : 'none');
  }

  private applyBlurEffect(path: fabric.Path): void {
    if (!this.canvas || !this.image) return;

    const context = this.canvas.getContext();
    const { left, top, width, height } = path.getBoundingRect();

    context.save();
    context.filter = `blur(${this.blurIntensity}px)`;
    context.drawImage(this.image.getElement(), left, top, width, height, left, top, width, height);
    context.restore();

    this.canvas.renderAll();
  }

  applyBlurSettings(settings: { active: boolean, intensity: number }) {
    if (settings.active) {
      this.blurIntensity = settings.intensity;
      this.activateBlurBrush();
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

    this.deactivateAllTools(); // Desativa todas as ferramentas antes de ativar o corte
    this.setActiveTool('crop');
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
        this.saveState();
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
      this.errorHandler.handleError(new Error("Canvas ou imagem não estão definidos."));
      return;
    }
    this.canvas.isDrawingMode = false;

    const width = this.image.width ?? 0;
    const height = this.image.height ?? 0;
    const scaleX = this.image.scaleX ?? 1;
    const scaleY = this.image.scaleY ?? 1;

    const imageURL = this.canvas.toDataURL({
      format: 'png',
      quality: 1,
      width: width * scaleX,
      height: height * scaleY
    });

    this.dialogRef.close({
      imageURL: imageURL
    });
  }
}
