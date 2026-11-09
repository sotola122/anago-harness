/** Serve one directory over loopback so a build can read files that a flaky CDN fails to deliver. */

const { createServer } = require('node:http')
const { readFile } = require('node:fs')
const { join, normalize } = require('node:path')

const root = process.argv[2]
const port = Number(process.argv[3] ?? '8099')
if (root === undefined) throw new Error('local-mirror: the directory to serve is required')

createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
  const file = normalize(join(root, name))
  if (!file.startsWith(normalize(root))) {
    response.writeHead(403)
    response.end()
    return
  }
  readFile(file, (error, bytes) => {
    if (error !== null) {
      response.writeHead(404)
      response.end()
      return
    }
    response.writeHead(200, { 'content-length': String(bytes.length), 'content-type': 'application/octet-stream' })
    response.end(bytes)
  })
}).listen(port, '127.0.0.1')
