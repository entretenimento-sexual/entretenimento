import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { SharedMaterialModule } from 'src/app/shared/shared-material.module';

export interface MediaDateDialogData {
  value: string;
}

@Component({
  selector: 'app-media-date-dialog',
  standalone: true,
  imports: [
    SharedMaterialModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
  ],
  templateUrl: './media-date-dialog.component.html',
  styleUrls: ['./media-date-dialog.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaDateDialogComponent {
  value: string;

  constructor(
    private readonly ref: MatDialogRef<MediaDateDialogComponent, string | null>,
    @Inject(MAT_DIALOG_DATA) data: MediaDateDialogData
  ) {
    this.value = String(data?.value ?? '').trim();
  }

  onInput(event: Event): void {
    this.value = (event.target as HTMLInputElement | null)?.value ?? '';
  }

  save(): void {
    this.ref.close(this.value || null);
  }

  cancel(): void {
    this.ref.close(undefined);
  }
}
