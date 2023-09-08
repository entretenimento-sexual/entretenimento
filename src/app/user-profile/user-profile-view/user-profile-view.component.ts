// src\app\user-profile\user-profile-view\user-profile-view.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from 'src/app/core/services/autentication/auth.service';

@Component({
  selector: 'app-user-profile-view',
  templateUrl: './user-profile-view.component.html',
  styleUrls: ['./user-profile-view.component.css']
})
export class UserProfileViewComponent implements OnInit {

  userId!: string | null;
  userName: string | null | undefined = null;
  userNickname?: string | null | undefined = null;
  userIdade?: string | null | undefined = null;

  constructor(private route: ActivatedRoute,
              private authService: AuthService
    ) { }

  async ngOnInit(): Promise<void> {
    this.userId = this.route.snapshot.paramMap.get('id');
    if (this.userId) {
      const userData = await this.authService.getUserById(this.userId);
      if (userData) {
        this.userName = userData.nome || userData.displayName;
        this.userNickname = userData.nickname;
        this.userIdade = userData.idade?.toString() || null;
      }
  }
  }
}
