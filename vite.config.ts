import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const backendPort = Number.parseInt(String(env.PORT || '3355'), 10) || 3355;
  
  return {
    server: {
      port: 5188,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
          secure: false,
        }
      },
    },
    plugins: [
      {
        name: 'classic-create-route',
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (req.url === '/create/classic' || req.url === '/create/classic/') {
              req.url = '/classic-app/index.html';
            }
            next();
          });
        },
      },
      react(),
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: [],
    },
  };
});
