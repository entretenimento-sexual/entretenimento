//src\app\admin-dashboard\user-details\user-details.component.ts
import { Component, Input } from '@angular/core';
import { UserManagementService } from 'src/app/core/services/account-moderation/user-management.service';
import { UserModerationService } from 'src/app/core/services/account-moderation/user-moderation.service';

@Component({
  selector: 'app-user-details',
  templateUrl: './user-details.component.html',
  styleUrl: './user-details.component.css',
  standalone: false
})

export class UserDetailsComponent {
  @Input() user: any;

  constructor(private userManagementService: UserManagementService,
              private userModeration: UserModerationService
            ) { }

  suspendUser(): void {
    this.userModeration.suspendUser(this.user.uid, 'Violação de regras', 'ADMIN_UID').subscribe(() => {
      alert('Usuário suspenso com sucesso!');
    });
  }

  unsuspendUser(): void {
    this.userModeration.unsuspendUser(this.user.uid, 'ADMIN_UID').subscribe(() => {
      alert('Usuário reativado com sucesso!');
    });
  }

  deleteUser(): void {
    this.userManagementService.deleteUserAccount(this.user.uid).subscribe(() => {
      alert('Conta excluída permanentemente.');
    });
  }
}
