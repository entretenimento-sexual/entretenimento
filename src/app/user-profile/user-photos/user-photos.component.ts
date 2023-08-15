//src\app\user-profile\user-photos\user-photos.component.ts
import { Component, OnInit, Input } from '@angular/core';
import { UserProfileService } from '../services-profile/user-profile.service';

@Component({
  selector: 'app-user-photos',
  templateUrl: './user-photos.component.html',
  styleUrls: ['./user-photos.component.css']
})
export class UserPhotosComponent implements OnInit {
  @Input() userId!: string;
  userPhotos: any[] = [];

  constructor(private userProfileService: UserProfileService) { }

  ngOnInit(): void {
    // Supondo que você tenha um método getUserPhotos em seu UserProfileService
    this.userProfileService.getUserPhotos(this.userId).subscribe(photos => {
      this.userPhotos = photos;
    });
  }
}

