import { Pipe, PipeTransform } from '@angular/core';

const texts: Record<string, string> = { 'home.subscribe': 'Subscribe' };

@Pipe({ name: 'translate', standalone: true })
export class TranslatePipe implements PipeTransform {
  transform(key: string): string { return texts[key] ?? key; }
}
