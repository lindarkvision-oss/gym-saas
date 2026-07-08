import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-coach-192.jpeg', 'icon-coach-512.jpeg'],
      manifest: {
        short_name: "CoachGym",
        name: "Coach - Gym Nouvel Élan",
        icons: [
          {
            src: "/icon-coach-192.jpeg",
            type: "image/jpeg",
            sizes: "192x192",
            purpose: "any"
          },
          {
            src: "/icon-coach-512.jpeg",
            type: "image/jpeg",
            sizes: "512x512",
            purpose: "any"
          }
        ],
        start_url: "/coach.html",
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
    host: true
  },
  build: {
    outDir: 'dist-coach',
    rollupOptions: {
      input: {
        coach: resolve(__dirname, 'coach.html')
      }
    }
  }
})