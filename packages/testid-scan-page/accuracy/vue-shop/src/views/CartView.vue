<template>
  <section>
    <h1>Cart</h1>
    <ul>
      <li v-for="item in items" :key="item.id">
        <span>{{ item.name }}</span>
        <button data-gt="cart-remove" @click="remove(item)">Remove</button>
      </li>
    </ul>
    <label>Gift note <textarea data-gt="cart-note"></textarea></label>
    <button data-gt="cart-checkout" @click="checkout">Checkout</button>
    <a href="#/" data-gt="cart-continue">Continue shopping</a>
  </section>
</template>
<script setup>
import { ref } from 'vue';
const items = ref([{ id: 1, name: 'Lamp' }, { id: 2, name: 'Desk' }]);
const remove = (item) => { items.value = items.value.filter((i) => i !== item); };
const checkout = () => {};
</script>
