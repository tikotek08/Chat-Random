import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const nm = path.join(__dirname, 'node_modules')

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Evita que `tailwindcss` se resuelva desde el padre (p. ej. Desktop) cuando la ruta del
  // proyecto contiene espacios — el bundler tomaba `C:\Users\...\Desktop` como contexto.
  turbopack: {
    root: __dirname,
    resolveAlias: {
      tailwindcss: path.join(nm, 'tailwindcss'),
      'tw-animate-css': path.join(nm, 'tw-animate-css'),
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      tailwindcss: path.join(nm, 'tailwindcss'),
      'tw-animate-css': path.join(nm, 'tw-animate-css'),
    }
    config.resolve.modules = [nm, ...(config.resolve.modules || [])]
    return config
  },
}

export default nextConfig
