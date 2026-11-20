import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { lingui } from '@lingui/vite-plugin';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    return {
      server: {
        port: 3333,
        host: '0.0.0.0',
        headers: {
          // Content Security Policy - prevents XSS and other injection attacks
          'Content-Security-Policy': [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Required for Vite HMR and React
            "style-src 'self' 'unsafe-inline'", // CSS-in-JS
            "img-src 'self' data: https: blob: http://localhost:* http://127.0.0.1:*", // As in production: data URLs, HTTPS, blobs, and a local Convex's storage
            "connect-src 'self' wss: https: ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*", // Allow secure connections and loopback HTTP/WebSockets during local development
            "media-src 'self' blob: https:", // Allow media from blobs and recordings in remote storage
            "font-src 'self' data:", // Self-hosted fonts plus data-URL fonts
            "object-src 'none'", // Block plugins
            "frame-ancestors 'none'", // Prevent clickjacking
            "base-uri 'self'", // Restrict base URL
            "form-action 'self'" // Restrict form submissions
          ].join('; '),
          // Prevent MIME type sniffing
          'X-Content-Type-Options': 'nosniff',
          // Prevent clickjacking
          'X-Frame-Options': 'DENY',
          // Enable XSS filter (legacy, but adds defense in depth)
          'X-XSS-Protection': '1; mode=block',
          // Control referrer information
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          // Feature policy for camera and microphone access
          'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()'
        }
      },
      plugins: [
        tailwindcss(),
        react({
          plugins: [["@lingui/swc-plugin", {}]],
        }),
        lingui(),
      ],
      resolve: {
        alias: {
          '@': path.resolve(import.meta.dirname, '.'),
        }
      },
      build: {
        minify: 'esbuild',
        // SECURITY: Remove console logging in production builds
        esbuild: {
          drop: mode === 'production' ? ['console', 'debugger'] : []
        }
      }
    };
});
