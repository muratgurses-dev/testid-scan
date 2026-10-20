<template>
  <AppHeader />
  <main>
    <HomeView v-if="route === '/'" />
    <CartView v-else-if="route === '/cart'" />
    <AdminView v-else-if="route === '/admin'" />
  </main>
  <AppFooter />
</template>
<script setup>
import { ref } from 'vue';
import AppHeader from './components/AppHeader.vue';
import AppFooter from './components/AppFooter.vue';
import HomeView from './views/HomeView.vue';
import CartView from './views/CartView.vue';
import AdminView from './views/AdminView.vue';
const route = ref(location.hash.slice(1) || '/');
addEventListener('hashchange', () => { route.value = location.hash.slice(1) || '/'; });
</script>
