<template>
  <VSafeArea :style="{ flex: 1, backgroundColor: '#ffffff' }">
    <RouterView />
  </VSafeArea>
</template>

<script setup lang="ts">
import { RouterView } from '@thelacanians/vue-native-navigation'
</script>
