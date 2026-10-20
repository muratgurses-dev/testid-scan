<template>
  <li>
    <span>{{ product.name }}</span>
    <!-- TRAP repeated: one per product -->
    <button data-gt="row-add" @click="add">Add to cart</button>
    <!-- TRAP repeated fixed test ID -->
    <a :href="'#/p/' + product.id" data-testid="product-details-link" data-gt="row-details">Details</a>
  </li>
</template>
<script setup>
defineProps({ product: Object });
const add = () => {};
</script>
