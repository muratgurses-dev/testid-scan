import { useEffect, useState } from 'react';
import AppHeader from './components/AppHeader.jsx';
import AppFooter from './components/AppFooter.jsx';
import HomeView from './views/HomeView.jsx';
import CartView from './views/CartView.jsx';
import AdminView from './views/AdminView.jsx';

const current = () => location.hash.slice(1) || '/';

export default function App() {
  const [route, setRoute] = useState(current());
  useEffect(() => {
    const onChange = () => setRoute(current());
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return (
    <>
      <AppHeader />
      <main>
        {route === '/' ? <HomeView /> : route === '/cart' ? <CartView /> : route === '/admin' ? <AdminView /> : null}
      </main>
      <AppFooter />
    </>
  );
}
