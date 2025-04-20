//src\app\shared\components-globais\user-card\modal-user-card\modal-user-card.component.ts
import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { CompactUserCardComponent } from '../compact-user-card/compact-user-card.component';
import { DetailedUserCardComponent } from '../detailed-user-card/detailed-user-card.component';

@Component({
  selector: 'app-modal-user-card',
  imports: [CommonModule, CompactUserCardComponent, DetailedUserCardComponent],
  templateUrl: './modal-user-card.component.html',
  styleUrl: './modal-user-card.component.css'
})

export class ModalUserCardComponent {
  readonly user = input.required<IUserDados>();
  isHovered = false;
}
