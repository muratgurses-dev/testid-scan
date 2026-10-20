import { Component, input } from '@angular/core';

@Component({ selector: 'app-product-row', standalone: true, templateUrl: './product-row.component.html' })
export class ProductRowComponent {
  product = input.required<{ id: number; name: string }>();
}
