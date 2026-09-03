import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  const isGitHubPages = env.GITHUB_PAGES === 'true';
  return {
    base: isGitHubPages ? '/nir/' : '/',
    plugins: [react()],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        'firebase/firestore': `${process.cwd()}/services/firestoreProxy.ts`,
      },
    },
    build: {
      // Client assets live in a dedicated directory for the Node server and static deployment.
      outDir: 'dist/client',
      target: 'esnext',
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      assetsInlineLimit: 0,
      cssCodeSplit: true,
      chunkSizeWarningLimit: 1500,
      emptyOutDir: true,
    },
    css: {
      preprocessorMaxWorkers: 0,
    },
  };
});
