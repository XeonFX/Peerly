import { readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const directory = resolve(process.argv[2] ?? 'dist/assets')
const maxEntryBytes = Number(process.argv[3] ?? 700_000)
const files = readdirSync(directory)
  .map(name => ({ name, path: join(directory, name) }))
  .filter(file => statSync(file.path).isFile() && file.name.endsWith('.js'))
const entries = files.filter(file => /^index-[\w-]+\.js$/.test(basename(file.name)))
if (entries.length === 0) throw new Error(`No Vite index JavaScript asset found in ${directory}`)
const oversized = entries.filter(file => statSync(file.path).size > maxEntryBytes)
for (const file of entries) {
  console.log(`${file.name}: ${statSync(file.path).size} bytes (budget ${maxEntryBytes})`)
}
if (oversized.length > 0) {
  throw new Error(`Entry bundle budget exceeded: ${oversized.map(file => file.name).join(', ')}`)
}
