import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const consumer = process.argv[2] && resolve(process.argv[2])
if (!consumer) throw new Error('Usage: node scripts/pack-core-for-consumer.mjs /path/to/consumer')
function run(args, cwd) {
  const result = spawnSync('npm', args, { cwd, stdio: 'inherit', shell: false })
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed`)
}
const core = resolve(root, 'packages/core')
const version = JSON.parse(readFileSync(resolve(core, 'package.json'), 'utf8')).version
const vendor = resolve(consumer, 'vendor')
mkdirSync(vendor, { recursive: true })
run(['pack', core, '--pack-destination', vendor], root)
run(['install', '--ignore-scripts', '--save-exact', `./vendor/peerly-core-${version}.tgz`], consumer)
console.log('Consumer is pinned to the packed core. Run its unit, Worker and browser suites before release.')
