// src/app/shared/location-cta/location-cta.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Firestore } from '@angular/fire/firestore';

import { LocationCtaComponent } from './location-cta.component';

describe('LocationCtaComponent', () => {
  let component: LocationCtaComponent;
  let fixture: ComponentFixture<LocationCtaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LocationCtaComponent, RouterTestingModule],
      providers: [
        { provide: Firestore, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LocationCtaComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
