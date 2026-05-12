import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DiscoveryModeTabsComponent } from './discovery-mode-tabs.component';

describe('DiscoveryModeTabsComponent', () => {
  let component: DiscoveryModeTabsComponent;
  let fixture: ComponentFixture<DiscoveryModeTabsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiscoveryModeTabsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DiscoveryModeTabsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
