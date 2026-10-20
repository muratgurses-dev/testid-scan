import { Component } from '@angular/core';

@Component({ selector: 'app-cart', standalone: true, templateUrl: './cart.component.html' })
export class CartComponent {
  items = [{ id: 1, name: 'Lamp' }, { id: 2, name: 'Desk' }];
  remove(item: { id: number }) { this.items = this.items.filter((i) => i !== item); }
}
