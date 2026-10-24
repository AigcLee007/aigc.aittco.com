import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const buildIdPath = path.resolve(__dirname, 'public/build-id.txt');
  const appBuildId = fs.existsSync(buildIdPath)
    ? fs.readFileSync(buildIdPath, 'utf8').trim()
    : env.VITE_BUILD_ID || 'development';
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
        },
        '/generated-assets': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
          secure: false,
        }
      },
    },
    plugins: [
      {
        name: 'write-app-build-id',
        closeBundle() {
          const outputDir = path.resolve(__dirname, 'dist');
          fs.writeFileSync(path.join(outputDir, 'build-id.txt'), appBuildId);
          const classicHtmlPath = path.join(outputDir, 'classic-app', 'index.html');
          if (fs.existsSync(classicHtmlPath)) {
            const html = fs.readFileSync(classicHtmlPath, 'utf8');
            fs.writeFileSync(classicHtmlPath, html.replaceAll('app-build-placeholder', appBuildId));
          }
        },
      },
      {
        name: 'classic-create-route',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/create/classic' || req.url === '/create/classic/') {
              res.statusCode = 302;
              res.setHeader('Location', '/vip');
              res.end();
              return;
            }
            if (req.url === '/vip' || req.url === '/vip/') {
              req.url = '/classic-app/index.html';
            }
            next();
          });
        },
      },
      react(),
    ],
    define: {
      __APP_BUILD_ID__: JSON.stringify(appBuildId),
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
