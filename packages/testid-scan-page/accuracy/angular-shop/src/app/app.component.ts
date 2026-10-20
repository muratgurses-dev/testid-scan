import { Component, signal } from '@angular/core';
import { HeaderComponent } from './components/header.component';
import { FooterComponent } from './components/footer.component';
import { HomeComponent } from './views/home.component';
import { CartComponent } from './views/cart.component';
import { AdminComponent } from './views/admin.component';

const current = () => location.hash.slice(1) || '/';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [HeaderComponent, FooterComponent, HomeComponent, CartComponent, AdminComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {
  route = signal(current());
  constructor() { addEventListener('hashchange', () => this.route.set(current())); }
}
