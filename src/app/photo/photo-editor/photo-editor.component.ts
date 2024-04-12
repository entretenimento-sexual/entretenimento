//src\app\photo\photo-editor\photo-editor.component.ts
import { Component, Inject, OnInit, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { fabric } from 'fabric';

@Component({
  selector: 'app-photo-editor',
  templateUrl: './photo-editor.component.html',
  styleUrls: ['./photo-editor.component.css']
})
export class PhotoEditorComponent implements OnInit, AfterViewInit {
  @ViewChild('photoContainer') photoContainer!: ElementRef;
  canvas?: fabric.Canvas;
  image?: fabric.Image;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: any,
    private dialogRef: MatDialogRef<PhotoEditorComponent>
  ) { }

  origX: number = 0;
  origY: number = 0;
  isDown: boolean = false;
  cropRect: fabric.Rect | null = null;


  ngOnInit(): void { }


  ngAfterViewInit(): void {
    if (this.data.file && this.data.file instanceof File) {
      this.loadImage();
    } else {
      console.error("O arquivo não é válido");
    }
  }

  loadImage(): void {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      fabric.Image.fromURL(e.target.result, (img) => {
        this.initializeCanvas();
        this.adjustImageSize(img);
      }, { crossOrigin: 'anonymous' });
    };
    reader.onerror = (error) => {
      console.error('Erro ao carregar a imagem:', error);
      // Exibir mensagem de erro para o usuário
    };
    reader.readAsDataURL(this.data.file);
  }

  initializeCanvas(): void {
    const container = this.photoContainer.nativeElement;
    this.canvas = new fabric.Canvas('canvasID', {
      width: container.clientWidth,
      height: container.clientHeight
    });

    // Adiciona manipuladores de eventos para desenhar o retângulo de recorte
    this.canvas.on('mouse:down', (o) => {
      if (!this.canvas) return; // Verifica se o canvas existe
      const pointer = this.canvas.getPointer(o.e);
      this.origX = pointer.x;
      this.origY = pointer.y;
      this.isDown = true;
      this.cropRect = new fabric.Rect({
        left: this.origX,
        top: this.origY,
        originX: 'left',
        originY: 'top',
        width: pointer.x - this.origX,
        height: pointer.y - this.origY,
        angle: 0,
        fill: 'rgba(255,255,255,0.3)',
        transparentCorners: false
      });
      this.canvas.add(this.cropRect);
    });

    this.canvas.on('mouse:move', (o) => {
      if (!this.isDown || !this.cropRect || !this.canvas) return; // Adiciona verificação para canvas
      const pointer = this.canvas.getPointer(o.e);

      if (this.origX > pointer.x) {
        this.cropRect.set({ left: Math.abs(pointer.x) });
      }
      if (this.origY > pointer.y) {
        this.cropRect.set({ top: Math.abs(pointer.y) });
      }

      this.cropRect.set({ width: Math.abs(this.origX - pointer.x) });
      this.cropRect.set({ height: Math.abs(this.origY - pointer.y) });
      this.canvas.renderAll();
    });

    this.canvas.on('mouse:up', () => {
      this.isDown = false;
      // Aqui você pode opcionalmente chamar um método para tratar o recorte
    });
  }

  adjustImageSize(img: fabric.Image): void {
    if (!this.canvas) return; // Adiciona esta linha para verificar se canvas existe
    const scale = Math.min(
      this.canvas.getWidth() / (img.width || 1), // Usa 1 como fallback para evitar divisão por zero
      this.canvas.getHeight() / (img.height || 1)
    );

    img.scale(scale).set({
      left: (this.canvas.getWidth() - img.getScaledWidth()) / 2,
      top: (this.canvas.getHeight() - img.getScaledHeight()) / 2,
    });

    this.canvas.add(img).renderAll();
    this.image = img;
  }

rotate(): void {
    if (this.image) {
      this.image.rotate((this.image.angle || 0) + 90);
      this.canvas?.centerObject(this.image);
      this.canvas?.renderAll();
    }
  }

  initiateCrop(): void {
    // Ativar a funcionalidade de recorte aqui
    // Isso pode incluir configurar o canvas para entrar em um "modo de recorte"
    console.log("Iniciando o recorte.");
  }

  crop() {
    // Lógica para recortar a imagem
  }

  saveAndClose(): void {
    const dataUrl = this.canvas?.toDataURL({
      format: 'png',
      quality: 1
    });

    if (dataUrl) {
      fetch(dataUrl)
        .then(res => res.blob())
        .then(blob => {
          // Feche o diálogo e envie a foto editada de volta
          this.dialogRef.close({ action: 'salvar', file: blob });
        });
    }
  }

  adjustBrightness(event: Event): void {
    const input = event.target as HTMLInputElement;
    const brightnessValue = parseFloat(input.value);

    if (this.image) {
      const filter = new fabric.Image.filters.Brightness({
        brightness: brightnessValue
      });
      this.image.filters = [filter];
      this.image.applyFilters();
      if (this.canvas && this.image)
      this.canvas.renderAll();
    }
  }

  adjustContrast(event: Event): void {
    const input = event.target as HTMLInputElement;
    const contrastValue = parseFloat(input.value);

    if (this.image) {
      const filter = new fabric.Image.filters.Contrast({
        contrast: contrastValue
      });
      this.image.filters = [filter];
      this.image.applyFilters();
      if (this.canvas && this.image)
      this.canvas.renderAll();
    }
  }

  activateBlurBrush(): void {
    if (!this.canvas || !this.image) return;
    const cursorPath = 'assets\circle_cursor.edit-photo.png';

    this.canvas.defaultCursor = `url('${cursorPath}') 0 32, auto`; // Ajuste os valores 0 32 conforme necessário
    this.canvas.hoverCursor = `url('${cursorPath}') 0 32, auto`;
    this.canvas.moveCursor = `url('${cursorPath}') 0 32, auto`;

    this.image.selectable = false;
    this.image.evented = false;
    this.canvas.forEachObject((obj) => {
      obj.selectable = false; // Desativa a seleção de todos os objetos
    });
    this.canvas.selection = false; // Desativa a seleção de área
    this.canvas.renderAll();

    let isDrawing = false;
    let lastPointer: { x: number; y: number } | null = null;



    this.canvas.on('mouse:down', (event: fabric.IEvent) => {
      isDrawing = true;
      const pointer = this.canvas?.getPointer(event.e);
      lastPointer = pointer ?? null;
    });

    this.canvas.on('mouse:move', (event: fabric.IEvent) => {
      if (!isDrawing || !this.canvas) return;
      const pointer = this.canvas.getPointer(event.e);

      if (lastPointer) {
        // Calcular distância entre o último ponto e o atual
        const distance = Math.sqrt(Math.pow(pointer.x - lastPointer.x, 2) + Math.pow(pointer.y - lastPointer.y, 2));

        // Criar um círculo (pincel de borrão) na posição atual do cursor
        const brush = new fabric.Circle({
          left: pointer.x,
          top: pointer.y,
          radius: 10,
          fill: `rgba(255,255,255,${Math.min(1, distance / 10)})`, // Ajusta a opacidade com base na distância
          selectable: false,
          evented: false,
        });

        this.canvas.add(brush);
      }

      lastPointer = pointer;
    });

    this.canvas.on('mouse:up', () => {
      isDrawing = false;
      lastPointer = null;
    });
  }

  }
