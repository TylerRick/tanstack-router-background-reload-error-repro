import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
	plugins: [solid()],
	server: { port: 5596, strictPort: true },
});
