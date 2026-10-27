import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const model = (await readFile(join(root, 'src/model.cjs'), 'utf8'))
  // The pure model is concatenated into the bundle; drop its CommonJS tail.
  .replace(/\nmodule\.exports\s*=\s*\{[\s\S]*$/, '\n')
const css = await readFile(join(root, 'src/styles.css'), 'utf8')
const ui = await readFile(join(root, 'src/client.js'), 'utf8')

const bundle = `window.__ModuleLoader__.load({ id: "dsh-ai-mind", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

${model}

const AI_MIND_VERSION = ${JSON.stringify(pkg.version)};
const AI_MIND_CSS = ${JSON.stringify(css)};

${ui}

module.exports = { name: "dsh-ai-mind", inject: ["betterSidebar", "sidebarRight", "sessions"], apply };
return module.exports;
}});
`

await mkdir(join(root, 'lib'), { recursive: true })
await writeFile(join(root, 'lib/client.js'), bundle)
console.log(`built lib/client.js (${bundle.length} bytes)`)
