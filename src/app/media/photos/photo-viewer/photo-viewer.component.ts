// src/app/media/photos/photo-viewer/photo-viewer.component.ts
// Não esqueça os comentários explicativos e ferramentas de debug.
// Viewer modal (MVP):
// - Recebe lista de fotos + índice inicial via MAT_DIALOG_DATA
// - Navegação anterior/próxima
// - Acessível (aria, botões, foco natural)

import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface IProfilePhotoItem {
  id: string;
  url: string;
  alt?: string;
  createdAt?: number;
}

export interface IPhotoViewerData {
  ownerUid: string;
  items: IProfilePhotoItem[];
  startIndex: number;
}

@Component({
  selector: 'app-photo-viewer',
  standalone: true,
  imports: [CommonModule, MatDialogModule],
  templateUrl: './photo-viewer.component.html',
  styleUrls: ['./photo-viewer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoViewerComponent {
  private readonly DEBUG = true;

  index: number;

  constructor(
    private readonly dialogRef: MatDialogRef<PhotoViewerComponent>,
    @Inject(MAT_DIALOG_DATA) public readonly data: IPhotoViewerData
  ) {
    this.index = Math.max(0, Math.min(data.startIndex ?? 0, (data.items?.length ?? 1) - 1));
    this.DEBUG && console.debug('[PhotoViewer] init', { index: this.index, count: data.items?.length });
  }

  get current(): IProfilePhotoItem | null {
    return this.data.items?.[this.index] ?? null;
  }

  get hasPrev(): boolean {
    return this.index > 0;
  }

  get hasNext(): boolean {
    return this.index < (this.data.items?.length ?? 0) - 1;
  }

  close(): void {
    this.dialogRef.close();
  }

  prev(): void {
    if (!this.hasPrev) return;
    this.index -= 1;
  }

  next(): void {
    if (!this.hasNext) return;
    this.index += 1;
  }
}
