import { useState } from 'react';
import './header.css';

export default function AppHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header>
      <a href="#/" data-gt="header-home">Home</a>
      <a href="#/cart" data-gt="header-cart">Cart</a>
      {/* TRAP shared name: "Help" is also in AppFooter, and both are always on the page */}
      <a href="#/help" data-gt="header-help">Help</a>
      {/* TRAP missing name: an icon-only button */}
      <button className="icon" data-gt="header-icon" onClick={() => setOpen(!open)}><svg width="12" height="12" /></button>
      {/* TRAP hidden by CSS: two "Menu" buttons in one file, the mobile one is display:none */}
      <button className="desktop" data-gt="header-menu-desktop" onClick={() => setOpen(!open)}>Menu</button>
      <button className="mobile" data-gt="header-menu-mobile" onClick={() => setOpen(!open)}>Menu</button>
    </header>
  );
}
