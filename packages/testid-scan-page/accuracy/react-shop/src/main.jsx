import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Toast from './components/Toast.jsx';

createRoot(document.getElementById('root')).render(<App />);

// TRAP wrong target: rendered from code into its own root, so the static scanner never sees where Toast is used.
// Its "Close" button is the only "Close" on the home screen while the panel in HomeView is closed.
const holder = document.createElement('div');
document.body.appendChild(holder);
createRoot(holder).render(<Toast />);
