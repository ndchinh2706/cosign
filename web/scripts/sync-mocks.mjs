// Copies ../docs/mocks into public/mocks (no symlink, so Docker/Vercel builds see real files).
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, '../docs/mocks')
const dest = resolve(root, 'public/mocks')

if (!existsSync(src)) {
  console.error(`sync-mocks: ${src} not found`)
  process.exit(1)
}
rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true, filter: (p) => !p.endsWith('.md') })
console.log(`sync-mocks: ${src} -> ${dest}`)
