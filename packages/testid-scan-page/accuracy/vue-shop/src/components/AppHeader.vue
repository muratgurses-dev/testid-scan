<template>
  <header>
    <a href="#/" data-gt="header-home">Home</a>
    <a href="#/cart" data-gt="header-cart">Cart</a>
    <!-- TRAP shared name: "Help" is also in AppFooter, and both are always on the page -->
    <a href="#/help" data-gt="header-help">Help</a>
    <!-- TRAP missing name: an icon-only button -->
    <button class="icon" data-gt="header-icon" @click="open = !open"><svg width="12" height="12"></svg></button>
    <!-- TRAP hidden by CSS: two "Menu" buttons in one file, the mobile one is display:none -->
    <button class="desktop" data-gt="header-menu-desktop" @click="open = !open">Menu</button>
    <button class="mobile" data-gt="header-menu-mobile" @click="open = !open">Menu</button>
  </header>
</template>
<script setup>
import { ref } from 'vue';
const open = ref(false);
</script>
<style>.mobile { display: none; }</style>
