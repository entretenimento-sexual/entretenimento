//src\app\admin-dashboard\user-list\user-list.component.ts
import { Component, OnInit } from '@angular/core';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UserManagementService } from 'src/app/core/services/account-moderation/user-management.service';

interface IUserDadosExtended extends IUserDados {
  suspended: boolean; // ✅ Adiciona localmente sem modificar a interface global
}

@Component({
  selector: 'app-user-list',
  templateUrl: './user-list.component.html',
  styleUrl: './user-list.component.css',
  standalone:false
})

export class UserListComponent implements OnInit {
  users: IUserDadosExtended[] = [];

  constructor(private userManagementService: UserManagementService) { }

  ngOnInit(): void {
    this.loadUsers();
  }

  loadUsers(): void {
    this.userManagementService.getAllUsers().subscribe(users => {
      this.users = users.map(user => ({
        ...user,
        suspended: user.suspended ?? false // Garantindo um valor padrão
      }));
    });
  }

  viewUserDetails(user: IUserDados): void {
    alert(`Detalhes do usuário: ${user.nome} - ${user.email}`);
  }
}
