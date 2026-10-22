/**
 * Deterministic Brave and Exa search endpoints for the fork search-provider
 * snapshot.
 *
 * Both providers are mounted and usable; the scenario composition selects
 * Brave, so the recorded turn must be served by this fixture's Brave endpoint
 * and its Exa endpoint must record no request. Titles name their provider so
 * the recorded transcript shows which one served the search.
 * @module anago-search/search-fixture
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Observed calls per provider endpoint. */
export interface SearchFixtureCalls {
  /** Requests served from the Brave endpoint. */
  brave: number
  /** Requests served from the Exa endpoint; must stay zero. */
  exa: number
}

/** A running fixture endpoint pair. */
export interface SearchFixture {
  /** Base URL the scenario patches compose with `/brave` or `/exa`. */
  readonly url: string
  /** Requests observed so far. */
  readonly calls: SearchFixtureCalls
  /** Stop the listener. */
  close(): Promise<void>
}

/** Brave's documented `web.results` body. */
function braveBody(): unknown {
  return {
    type: 'search',
    web: {
      type: 'search',
      results: [{
        url: 'https://brave.example/anago-snapshot',
        title: 'Brave fixture: selected search provider',
        description: 'Served by the configured brave provider.',
      }],
    },
  }
}

/** Exa's documented `results` body; never served while Brave is selected. */
function exaBody(): unknown {
  return {
    results: [{
      url: 'https://exa.example/anago-snapshot',
      title: 'Exa fixture: unselected search provider',
      publishedDate: '2026-01-01',
      highlights: ['Served by the exa provider.'],
    }],
  }
}

/** Whether `request` addresses `path` with `method` on the fixture listener. */
function matches(request: { method?: string | undefined }, url: URL, method: string, path: string): boolean {
  return request.method === method && url.pathname === path
}

/**
 * Start the fixture listener on an OS-assigned loopback port.
 * @returns the base URL, the mutable call log, and the closer.
 */
export async function startSearchFixture(): Promise<SearchFixture> {
  const calls: SearchFixtureCalls = { brave: 0, exa: 0 }
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (matches(request, url, 'GET', '/brave/res/v1/web/search')) {
      calls.brave += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(braveBody()))
      return
    }
    if (matches(request, url, 'POST', '/exa/search')) {
      calls.exa += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(exaBody()))
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  server.unref()
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    calls,
    async close(): Promise<void> {
      if (!server.listening) return
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
        server.closeAllConnections()
      })
    },
  }
}
