import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(() => {
  const pilotEnv = loadEnv('piloto', process.cwd())
  return {
    define: {
      'import.meta.env.VITE_ESTOQUE_SUPABASE_URL': JSON.stringify(pilotEnv.VITE_ESTOQUE_SUPABASE_URL),
      'import.meta.env.VITE_ESTOQUE_SUPABASE_KEY': JSON.stringify(pilotEnv.VITE_ESTOQUE_SUPABASE_KEY),
    },
    build: { rollupOptions: { input: { main: 'index.html', piloto: 'piloto.html' } } },
    plugins: [{
      name: 'offline-interface',
      apply: 'build',
      async writeBundle({ dir }) {
        const output = dir ?? 'dist'
        const files = (await readdir(output, { recursive: true, withFileTypes: true }))
          .filter(file => file.isFile() && file.name !== 'sw.js' && file.name !== '_headers')
          .map(file => join(file.parentPath, file.name).slice(output.length + 1))
          .sort()
        const version = createHash('sha256')
        const integrity: Record<string, string> = {}
        for (const file of files) {
          version.update(file)
          const contents = await readFile(join(output, file))
          version.update(contents)
          const path = file === 'index.html' ? '/' : file === 'piloto.html' ? '/piloto' : '/' + file
          integrity[path] = 'sha256-' + createHash('sha256').update(contents).digest('base64')
        }
        const template = await readFile(new URL('./sw-template.js', import.meta.url), 'utf8')
        version.update(template)
        await writeFile(join(output, 'sw.js'), template
          .replace('__CACHE_NAME__', JSON.stringify('rn-estoque-' + version.digest('hex')))
          .replace('__CACHE_FILES__', JSON.stringify(integrity)))
      },
    }],
  }
})
