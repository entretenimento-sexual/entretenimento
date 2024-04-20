//src\app\photo\photo-editor\photo-editor.component.ts
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
  }

  private loadImage(imageUrl: string): void {
    fabric.Image.fromURL(imageUrl, (img) => {
      if (!this.canvas) return;
      console.log(`Dimensões da imagem original: ${img.width} x ${img.height}`);
      img.set({
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true,
        lockSkewingX: true,
        lockSkewingY: true,
      });

      // Aqui ajustamos o tamanho do canvas para corresponder ao da imagem
      this.canvas.setWidth(img.getScaledWidth());
      this.canvas.setHeight(img.getScaledHeight());

      this.image = img;
      this.canvas.clear(); // Limpa o canvas antes de adicionar a nova imagem
      this.canvas.add(img);
      // Não é necessário chamar centerImage, pois o canvas agora tem o tamanho da imagem
      this.canvas.renderAll();
    }, { crossOrigin: 'anonymous' });
  }



  private centerImage(img: fabric.Image): void {
    if (!this.canvas) return;
    const canvasWidth = this.canvas.getWidth();
    const canvasHeight = this.canvas.getHeight();
    console.log(`Dimensões do canvas: ${canvasWidth} x ${canvasHeight}`);
    const imgWidth = (img.getScaledWidth());
    const imgHeight = (img.getScaledHeight());
    console.log(`Dimensões da imagem escalada: ${imgWidth} x ${imgHeight}`);
    const left = (canvasWidth - imgWidth) / 2;
    const top = (canvasHeight - imgHeight) / 2;
    img.set({ left: left, top: top }).setCoords();
    this.canvas.renderAll();
  }

  activateBlurBrush(): void {
    if (!this.canvas) {
      console.error("Canvas não está definido.");
      return;
    }

    this.canvas.isDrawingMode = true;
    const brush = new fabric.PencilBrush(this.canvas);
    brush.color = "white"; // Cor padrão do pincel
    brush.width = 15;
    this.canvas.freeDrawingBrush = brush;

    this.canvas.defaultCursor = 'url(assets/circle_cursor.png)';
    this.canvas.freeDrawingCursor = 'url(assets/circle_cursor.png) 16 16, crosshair';

    this.canvas.selection = false;
    if (this.image) {
      this.image.selectable = false;
      this.image.evented = false;
    }
  
    // Atualiza o canvas após desenhar
    this.canvas.on('path:created', () => {
      this.canvas?.renderAll();
    });
  }

  changeBrushColor(color: string): void {
    if (this.canvas && this.canvas.isDrawingMode) {
      const brush = this.canvas.freeDrawingBrush;
      brush.color = color;
    }
  }

  concludeAndClose(): void {
    if (!this.canvas || !this.image) {
      console.error("Canvas ou imagem não estão definidos.");
      return;
    }
    this.canvas.isDrawingMode = false;
    this.centerImage(this.image);

    // Exporta a imagem como URL de dados
    console.log(`Dimensões antes da exportação: ${this.image.getScaledWidth()} x ${this.image.getScaledHeight()}`);
    const imageURL = this.canvas.toDataURL({
      format: 'png',
      quality: 1, // A qualidade pode ser ajustada conforme necessário
    });

    // Fecha o dialog e passa a URL da imagem e quaisquer outros dados necessários
    this.dialogRef.close({
      imageURL: imageURL,
      // Inclua quaisquer outros dados que deseja retornar
    });
  }
}


