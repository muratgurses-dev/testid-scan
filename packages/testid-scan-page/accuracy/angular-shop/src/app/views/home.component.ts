import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { NgIf, NgTemplateOutlet } from '@angular/common';
import { ProductRowComponent } from '../components/product-row.component';
import { TranslatePipe } from '../translate.pipe';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [NgIf, NgTemplateOutlet, ProductRowComponent, TranslatePipe],
  templateUrl: './home.component.html',
  // styles turn on emulated encapsulation, which stamps every element of this template with _ngcontent-<id>
  styles: ['.promo { cursor: pointer; }'],
})
export class HomeComponent implements AfterViewInit {
  @ViewChild('confirm') confirm?: ElementRef<HTMLElement>;
  @ViewChild('banner') banner?: ElementRef<HTMLElement>;
  confirmOpen = true;
  bannerOpen = true;
  ngAfterViewInit() {
    for (const el of [this.confirm, this.banner]) if (el) document.body.appendChild(el.nativeElement);
  }
  q = '';
  saving = false;
  loading = false;
  fav = false;
  coupon: string | null = null;
  panelOpen = false;
  products = [{ id: 1, name: 'Lamp' }, { id: 2, name: 'Chair' }, { id: 3, name: 'Desk' }];
  get favLabel() { return this.fav ? 'Remove from favorites' : 'Add to favorites'; }
}
