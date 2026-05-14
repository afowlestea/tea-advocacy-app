import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/tea-advocacy-app/', 
  plugins: [react()],
})
