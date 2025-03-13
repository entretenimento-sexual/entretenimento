//src\app\shared\components-globais\user-card\compact-user-card\compact-user-card.component.ts
import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { BaseUserCardComponent } from "../base-user-card/base-user-card.component";

@Component({
  selector: 'app-compact-user-card',
  imports: [CommonModule, BaseUserCardComponent],
  templateUrl: './compact-user-card.component.html',
  styleUrl: './compact-user-card.component.css'
})

export class CompactUserCardComponent {
  @Input() user!: IUserDados;
}
