import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [{
    name: 'offline-interface',
    apply: 'build',
    async writeBundle({ dir }) {
      const output = dir ?? 'dist'
      const files = (await readdir(output, { recursive: true, withFileTypes: true }))
        .filter(file => file.isFile() && file.name !== 'sw.js')
        .map(file => join(file.parentPath, file.name).slice(output.length + 1))
        .sort()
      const version = createHash('sha256')
      for (const file of files) {
        version.update(file)
        version.update(await readFile(join(output, file)))
      }
      const template = await readFile(new URL('./sw-template.js', import.meta.url), 'utf8')
      version.update(template)
      await writeFile(join(output, 'sw.js'), template
        .replace('__CACHE_NAME__', JSON.stringify('rn-estoque-' + version.digest('hex')))
        .replace('__CACHE_FILES__', JSON.stringify(files.map(file => '/' + file))))
    },
  }],
})
