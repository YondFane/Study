import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { copyFile, cp, mkdir, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

function publishProjectAudio() {
  let projectRoot
  let outputRoot
  let basePath

  return {
    name: 'publish-project-audio',
    configResolved(config) {
      projectRoot = config.root
      outputRoot = resolve(config.root, config.build.outDir)
      basePath = config.base
    },
    configureServer(server) {
      const audioRoot = resolve(projectRoot, 'data/audio')
      const allowedRoot = `${audioRoot}${sep}`
      server.middlewares.use((request, response, next) => {
        const pathname = decodeURIComponent(String(request.url ?? '').split('?', 1)[0])
        const prefixes = [`${basePath}data/audio/`, '/data/audio/']
        const prefix = prefixes.find((candidate) => pathname.startsWith(candidate))
        if (!prefix) return next()

        const requestedFile = resolve(audioRoot, pathname.slice(prefix.length))
        if (!requestedFile.startsWith(allowedRoot)) {
          response.statusCode = 403
          response.end('Forbidden')
          return
        }

        request.url = `${basePath}@fs/${requestedFile.replaceAll('\\', '/')}`
        next()
      })
    },
    async buildStart() {
      // Keep the large audio tree between local builds, but remove stale hashed app chunks.
      await rm(resolve(outputRoot, 'assets'), { recursive: true, force: true })
    },
    async closeBundle() {
      await Promise.all([1, 2].map(async (audioType) => {
        const sourceRoot = resolve(projectRoot, `data/audio/type-${audioType}`)
        const destinationRoot = resolve(outputRoot, `data/audio/type-${audioType}`)
        await mkdir(destinationRoot, { recursive: true })
        await Promise.all([
          copyFile(resolve(sourceRoot, 'catalog.json'), resolve(destinationRoot, 'catalog.json')),
          cp(resolve(sourceRoot, 'lookup'), resolve(destinationRoot, 'lookup'), {
            recursive: true,
            force: true,
          }),
          cp(resolve(sourceRoot, 'files'), resolve(destinationRoot, 'files'), {
            recursive: true,
            force: false,
            errorOnExist: false,
          }),
        ])
      }))
    },
  }
}

export default defineConfig({
  base: '/StudyEnglish/',
  build: {
    // dist/data/audio contains thousands of files and may be in use by the local preview.
    // The audio plugin incrementally copies missing files instead of deleting the tree.
    emptyOutDir: false,
  },
  plugins: [vue(), publishProjectAudio()],
})
