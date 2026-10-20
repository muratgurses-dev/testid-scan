<template>
  <div role="status">
    Saved.
    <button data-gt="toast-close" @click="visible = false">Close</button>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const visible = ref(true);
</script>
