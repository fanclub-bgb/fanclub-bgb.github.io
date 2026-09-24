import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://bladgonza.github.io/bgb/',
  base: process.env.NODE_ENV === 'production' ? '/bgb/' : '/'
});