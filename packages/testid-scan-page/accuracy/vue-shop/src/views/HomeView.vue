<template>
  <section>
    <h1>Products</h1>
    <input v-model="q" placeholder="Search products" data-gt="home-search">
    <!-- TRAP if/else: the same name in two branches, only one is on the page.
         Both arms are "the Save button" a test wants, so they share one ground-truth id. -->
    <button v-if="saving" disabled data-gt="home-save">Save</button>
    <button v-else data-gt="home-save" @click="save">Save</button>
    <!-- TRAP name set at runtime -->
    <button :aria-label="favLabel" data-gt="home-favorite" @click="fav = !fav">♥</button>
    <!-- TRAP translation key: without the i18n file the scanner only knows the key -->
    <button data-gt="home-subscribe" @click="save">{{ $t('home.subscribe') }}</button>
    <!-- TRAP hidden in this state: the coupon button is not rendered until a coupon exists -->
    <button v-if="coupon" data-gt="home-coupon" @click="save">Apply coupon</button>
    <!-- TRAP wrong target: this panel is closed, but Toast.vue (mounted from code) also has a "Close" button -->
    <div v-if="panelOpen" class="panel">
      <button data-gt="home-panel-close" @click="panelOpen = false">Close</button>
    </div>
    <!-- TRAP portal: a dialog of this file, moved to <body> by Teleport. Its buttons are correct targets that sit
         outside the area of the rest of this file, so the region guess calls them wrong; a dev build knows better. -->
    <Teleport to="body">
      <div v-if="confirmOpen" role="dialog" aria-label="Confirm">
        <button data-gt="home-confirm" @click="confirmOpen = false">Confirm order</button>
        <button data-gt="home-keep" @click="confirmOpen = false">Keep shopping</button>
      </div>
    </Teleport>
    <!-- TRAP portal with one button: nothing else of this file is near it, so the region guess calls it wrong -->
    <Teleport to="body">
      <div v-if="bannerOpen" class="banner"><button data-gt="home-banner" @click="bannerOpen = false">Got it</button></div>
    </Teleport>
    <ul>
      <ProductRow v-for="p in products" :key="p.id" :product="p" />
    </ul>
    <!-- TRAP clickable div without a role -->
    <div class="promo" data-gt="home-promo" @click="save">Get 10% off</div>
  </section>
</template>
<script setup>
import { computed, ref } from 'vue';
import ProductRow from '../components/ProductRow.vue';
const q = ref(''); const saving = ref(false); const fav = ref(false); const coupon = ref(null); const panelOpen = ref(false); const confirmOpen = ref(true); const bannerOpen = ref(true);
const favLabel = computed(() => (fav.value ? 'Remove from favorites' : 'Add to favorites'));
const products = [{ id: 1, name: 'Lamp' }, { id: 2, name: 'Chair' }, { id: 3, name: 'Desk' }];
const save = () => {};
</script>
<style>.promo { cursor: pointer; }</style>
