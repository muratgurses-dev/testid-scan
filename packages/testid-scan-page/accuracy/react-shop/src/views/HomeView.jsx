import { useState } from 'react';
import { createPortal } from 'react-dom';
import ProductRow from '../components/ProductRow.jsx';
import { t } from '../i18n.js';

const products = [{ id: 1, name: 'Lamp' }, { id: 2, name: 'Chair' }, { id: 3, name: 'Desk' }];

// TRAP React only: a helper that returns JSX, handed to .map by name (README: not seen as repeated)
const renderCompare = (p) => (
  <li key={p.id}>
    <button data-gt="home-compare" onClick={() => {}}>Compare</button>
  </li>
);

export default function HomeView() {
  const [q, setQ] = useState('');
  const [saving] = useState(false);
  const [fav, setFav] = useState(false);
  const [coupon] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(true);
  const [bannerOpen, setBannerOpen] = useState(true);
  return (
    <section>
      <h1>Products</h1>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" data-gt="home-search" />
      {/* TRAP if/else: the same name in both sides of a ternary; both are "the Save button" (one ground-truth id) */}
      {saving ? <button disabled data-gt="home-save">Save</button> : <button data-gt="home-save" onClick={() => {}}>Save</button>}
      {/* TRAP name set at runtime */}
      <button aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} data-gt="home-favorite" onClick={() => setFav(!fav)}>♥</button>
      {/* TRAP translation key: without the i18n file the scanner only knows the key */}
      <button data-gt="home-subscribe" onClick={() => {}}>{t('home.subscribe')}</button>
      {/* TRAP hidden in this state: not rendered until a coupon exists */}
      {coupon && <button data-gt="home-coupon" onClick={() => {}}>Apply coupon</button>}
      {/* TRAP wrong target: this panel is closed, but Toast.jsx (rendered from code) also has a "Close" button */}
      {panelOpen && (
        <div className="panel">
          <button data-gt="home-panel-close" onClick={() => setPanelOpen(false)}>Close</button>
        </div>
      )}
      {/* TRAP portal: a dialog of this file, rendered into <body> with createPortal. Its buttons are correct targets
          outside the area of the rest of this file, so the region guess calls them wrong. */}
      {confirmOpen && createPortal(
        <div role="dialog" aria-label="Confirm">
          <button data-gt="home-confirm" onClick={() => setConfirmOpen(false)}>Confirm order</button>
          <button data-gt="home-keep" onClick={() => setConfirmOpen(false)}>Keep shopping</button>
        </div>,
        document.body,
      )}
      {/* TRAP portal with one button: nothing else of this file is near it, so the region guess calls it wrong */}
      {bannerOpen && createPortal(<div className="banner"><button data-gt="home-banner" onClick={() => setBannerOpen(false)}>Got it</button></div>, document.body)}
      <ul>
        {products.map((p) => <ProductRow key={p.id} product={p} />)}
      </ul>
      <ul>{products.map(renderCompare)}</ul>
      {/* TRAP clickable div without a role */}
      <div className="promo" data-gt="home-promo" onClick={() => {}}>Get 10% off</div>
    </section>
  );
}
