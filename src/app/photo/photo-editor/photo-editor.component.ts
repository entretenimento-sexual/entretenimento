// src/app/photo/photo-editor/photo-editor.component.ts
import { Component, Inject, OnInit, ViewChild, ElementRef } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { fabric } from 'fabric';

@Component({
  selector: 'app-photo-editor',
  templateUrl: './photo-editor.component.html',
  styleUrls: ['./photo-editor.component.css']
})
export class PhotoEditorComponent implements OnInit {
  @ViewChild('photoContainer') photoContainer!: ElementRef;
  private canvas?: fabric.Canvas;
  private image?: fabric.Image;
  private blurGroup = new fabric.Group([], { selectable: false, evented: false });
  isBrushActive: boolean = false;
  private blurIntensity: number = 5; // Intensidade padrão

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: any,
    private dialogRef: MatDialogRef<PhotoEditorComponent>
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
  }

  private loadImage(imageUrl: string): void {
    fabric.Image.fromURL(imageUrl, (img) => {
      if (!this.canvas) return;

      this.image = img;
      this.image.set({
        scaleX: 1,
        scaleY: 1,
        left: 0,
        top: 0
      });
      this.canvas.setWidth(img.width || this.canvas.getWidth());
      this.canvas.setHeight(img.height || this.canvas.getHeight());
      this.canvas.add(img);
      this.canvas.renderAll();
    }, { crossOrigin: 'anonymous' });
  }

  private centerImage(img: fabric.Image): void {
    if (!this.canvas) return;
    const canvasWidth = this.canvas.getWidth();
    const canvasHeight = this.canvas.getHeight();
    const imgWidth = img.width ?? 0;
    const imgHeight = img.height ?? 0;

    img.set({
      left: (canvasWidth - imgWidth) / 2,
      top: (canvasHeight - imgHeight) / 2
    });

    img.setCoords();
    this.canvas.renderAll();
  }

  activateBlurBrush(): void {
    if (!this.canvas) return;

    const brush = new fabric.PencilBrush(this.canvas);
    brush.color = `rgba(255,255,255,${this.blurIntensity / 10})`;
    brush.width = 15;
    this.canvas.freeDrawingBrush = brush;

    this.canvas.on('path:created', (event) => {
      const path = event.target;
      if (path && path instanceof fabric.Path) {
        path.selectable = false;
        this.blurGroup.addWithUpdate(path);
        this.applyBlurEffect(path);
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
  }

  private enableBlurBrush(intensity: number = 5): void {
    if (!this.canvas) return;

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

  concludeAndClose(): void {
    if (!this.canvas || !this.image) {
      console.error("Canvas ou imagem não estão definidos.");
      return;
    }
    this.canvas.isDrawingMode = false;
    this.centerImage(this.image);

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
