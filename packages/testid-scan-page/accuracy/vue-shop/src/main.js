import { createApp } from 'vue';
import App from './App.vue';
import Toast from './components/Toast.vue';

const texts = { 'home.subscribe': 'Subscribe' };
const app = createApp(App);
app.config.globalProperties.$t = (key) => texts[key] ?? key;
app.mount('#app');

// TRAP wrong target: mounted from code, so the static scanner never sees where Toast is used.
// Its "Close" button is the only "Close" on the home screen while the panel in HomeView is closed.
const holder = document.createElement('div');
document.body.appendChild(holder);
createApp(Toast).mount(holder);
