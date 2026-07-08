// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.jpeg', 'icon-512.jpeg'],
      manifest: {
        short_name: "GymNouvelElan",
        name: "Gym Nouvel Élan",
        icons: [
          {
            src: "/icon-192.jpeg",
            type: "image/jpeg",
            sizes: "192x192",
            purpose: "any"
          },
          {
            src: "/icon-512.jpeg",
            type: "image/jpeg",
            sizes: "512x512",
            purpose: "any"
          }
        ],
        start_url: "/",
        background_color: "#090909",
        theme_color: "#4ade80",
        display: "standalone",
        orientation: "portrait"
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/script\.google\.com\/macros\/s\/.*/,
            handler: 'NetworkFirst',
            options: {
              networkTimeoutSeconds: 10
            }
          }
        ],
        globPatterns: ['**/*.{js,css,html,ico,jpeg,png,svg,woff,woff2}'],
        globIgnores: ['**/*.map', '**/*.gz']
      },
      injectRegister: 'auto',
      devOptions: {
        enabled: true,
        type: 'module'
      }
    })
  ],
  server: {
    host: true,
    https: false
  },
  // ⬇️ AJOUTEZ CETTE SECTION ⬇️
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        coach: resolve(__dirname, 'coach.html'),
      }
    }
  }
})