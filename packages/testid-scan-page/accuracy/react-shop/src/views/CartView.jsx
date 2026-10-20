import { useState } from 'react';

export default function CartView() {
  const [items, setItems] = useState([{ id: 1, name: 'Lamp' }, { id: 2, name: 'Desk' }]);
  return (
    <section>
      <h1>Cart</h1>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.name}</span>
            <button data-gt="cart-remove" onClick={() => setItems(items.filter((i) => i !== item))}>Remove</button>
          </li>
        ))}
      </ul>
      <label>Gift note <textarea data-gt="cart-note" /></label>
      <button data-gt="cart-checkout" onClick={() => {}}>Checkout</button>
      <a href="#/" data-gt="cart-continue">Continue shopping</a>
    </section>
  );
}
