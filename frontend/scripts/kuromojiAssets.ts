import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import type { Connect, Plugin } from 'vite'

export const DICTIONARY_FILES = ['base.dat.gz', 'check.dat.gz', 'cc.dat.gz', 'tid.dat.gz', 'tid_pos.dat.gz',
  'tid_map.dat.gz', 'unk.dat.gz', 'unk_pos.dat.gz', 'unk_map.dat.gz', 'unk_char.dat.gz',
  'unk_compat.dat.gz', 'unk_invoke.dat.gz'] as const
const notices = ['LICENSE-2.0.txt', 'NOTICE.md'] as const

/** Serve/emit only the installed dictionary and its notices; never expose node_modules. */
export function kuromojiAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('kuromoji/package.json'))
  const files = new Map<string, string>([
    ...DICTIONARY_FILES.map(name => [name, join(root, 'dict', name)] as [string, string]),
    ...notices.map(name => [name, join(root, name)] as [string, string]),
  ])
  let prefix = '/assets/kuromoji/'
  let outputRoot = ''
  const serve = (preview: boolean): Connect.NextHandleFunction => {
    return (req, res, next) => {
      const path = new URL(req.url ?? '/', 'http://local.invalid').pathname
      if (!path.startsWith(prefix)) return next()
      const name = path.slice(prefix.length)
      const source = files.get(name)
      if (!source) { res.statusCode = 404; res.end(); return }
      res.setHeader('Content-Type', name.endsWith('.gz') ? 'application/octet-stream' : 'text/plain; charset=utf-8')
      res.end(readFileSync(preview ? join(outputRoot, name) : source))
    }
  }
  return {
    name: 'local-kuromoji-dictionary',
    configResolved(config) {
      prefix = new URL(config.base, 'http://local.invalid/').pathname + 'assets/kuromoji/'
      outputRoot = resolve(config.root, config.build.outDir, 'assets/kuromoji')
    },
    configureServer(server) {
      server.middlewares.use(serve(false))
    },
    // sirv otherwise treats a .gz suffix as Content-Encoding, causing double decompression.
    configurePreviewServer(server) { server.middlewares.use(serve(true)) },
    generateBundle() {
      for (const [name, path] of files) this.emitFile({ type: 'asset', fileName: `assets/kuromoji/${name}`, source: readFileSync(path) })
    },
  }
}
