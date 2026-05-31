import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import fs from 'fs';

export default defineConfig({
  plugins: [vue()],
  server: {
    https: {
      pfx: fs.readFileSync('../certs/cert.pfx'),
      passphrase: 'password'
    },
    host: '0.0.0.0',
    port: 5173
  }
});