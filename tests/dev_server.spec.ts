/*
 * @adonisjs/assembler
 *
 * (c) AdonisJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import ts from 'typescript'
import { test } from '@japa/runner'
import { DevServer } from '../index.js'
import { setTimeout as sleep } from 'node:timers/promises'

test.group('DevServer', () => {
  test('start() execute onDevServerStarted hook', async ({ assert, fs, cleanup }) => {
    assert.plan(1)

    await fs.create('bin/server.js', `process.send({ isAdonisJS: true, environment: 'web' })`)
    await fs.create('.env', 'PORT=3334')

    const devServer = new DevServer(fs.baseUrl, {
      assets: {
        enabled: false,
      },
      nodeArgs: [],
      scriptArgs: [],
      hooks: {
        onDevServerStarted: [
          async () => ({
            default: () => {
              assert.isTrue(true)
            },
          }),
        ],
      },
    })

    await devServer.start()
    cleanup(() => devServer.close())
    await sleep(600)
  })

  test('startAndWatch() execute onDevServerStarted hook', async ({ assert, fs, cleanup }) => {
    assert.plan(1)

    await fs.create('bin/server.js', `process.send({ isAdonisJS: true, environment: 'web' })`)
    await fs.create('.env', 'PORT=3334')

    const devServer = new DevServer(fs.baseUrl, {
      assets: {
        enabled: false,
      },
      nodeArgs: [],
      scriptArgs: [],
      hooks: {
        onDevServerStarted: [
          async () => ({
            default: () => {
              assert.isTrue(true)
            },
          }),
        ],
      },
    })

    await devServer.startAndWatch(ts)
    cleanup(() => devServer.close())
    await sleep(600)
  })

  test('execute onSourceFileChanged hook', async ({ assert, fs, cleanup }) => {
    assert.plan(1)

    await fs.createJson('tsconfig.json', {
      include: ['**/*'],
      exclude: [],
    })
    await fs.create('index.ts', 'console.log("hey")')
    await fs.create('bin/server.js', `process.send({ isAdonisJS: true, environment: 'web' })`)
    await fs.create('.env', 'PORT=3334')

    const devServer = new DevServer(fs.baseUrl, {
      assets: { enabled: false },
      nodeArgs: [],
      scriptArgs: [],
      hooks: {
        onSourceFileChanged: [
          async () => ({
            default: () => {
              assert.isTrue(true)
            },
          }),
        ],
      },
    })

    await devServer.startAndWatch(ts)
    cleanup(() => devServer.close())

    await sleep(100)
    await fs.create('index.ts', 'foo')
    await sleep(10)
  })

  test('wait for hooks to be registered', async ({ assert, fs, cleanup }) => {
    assert.plan(1)

    await fs.createJson('tsconfig.json', {
      include: ['**/*'],
      exclude: [],
    })
    await fs.create('index.ts', 'console.log("hey")')
    await fs.create('bin/server.js', `process.send({ isAdonisJS: true, environment: 'web' })`)
    await fs.create('.env', 'PORT=3334')

    const devServer = new DevServer(fs.baseUrl, {
      assets: { enabled: false },
      nodeArgs: [],
      scriptArgs: [],
      hooks: {
        onDevServerStarted: [
          async () => {
            await sleep(400)
            return {
              default: () => {
                assert.isTrue(true)
              },
            }
          },
        ],
      },
    })

    await devServer.startAndWatch(ts)
    cleanup(() => devServer.close())

    await sleep(500)
  }).timeout(10_000)

  test('onHttpServerMessage hook should be executed', async ({ assert, fs, cleanup }) => {
    let receivedMessages: any[] = []

    await fs.createJson('tsconfig.json', {
      include: ['**/*'],
      exclude: [],
    })
    await fs.create('index.ts', 'console.log("hey")')
    await fs.create(
      'bin/server.js',
      `
      process.send({ isAdonisJS: true, environment: 'web' });
      process.send({ type: 'http-server-message', message: 'hello' });
      `
    )
    await fs.create('.env', 'PORT=3334')

    const devServer = new DevServer(fs.baseUrl, {
      assets: { enabled: false },
      nodeArgs: [],
      scriptArgs: [],
      hooks: {
        onHttpServerMessage: [
          async () => ({
            default: (_, message, __) => {
              receivedMessages.push(message)
            },
          }),
        ],
      },
    })

    await devServer.startAndWatch(ts)
    cleanup(() => devServer.close())

    await sleep(500)

    assert.deepEqual(receivedMessages, [
      { isAdonisJS: true, environment: 'web' },
      { type: 'http-server-message', message: 'hello' },
    ])
  })

  test('can restart server from onHttpServerMessage hook', async ({ assert, fs, cleanup }) => {
    let receivedMessages: any[] = []

    await fs.createJson('tsconfig.json', {
      include: ['**/*'],
      exclude: [],
    })
    await fs.create('index.ts', 'console.log("hey")')
    await fs.create(
      'bin/server.js',
      `
      process.send({ isAdonisJS: true, environment: 'web' });
      process.send({ type: 'restart' });
      `
    )
    await fs.create('.env', 'PORT=3334')

    let wasRestarted = false

    const devServer = new DevServer(fs.baseUrl, {
      assets: { enabled: false },
      nodeArgs: [],
      scriptArgs: [],
      hooks: {
        onHttpServerMessage: [
          async () => ({
            default: (_, message, { restartServer }) => {
              receivedMessages.push(message)

              if (message.type === 'restart' && !wasRestarted) {
                restartServer()
                wasRestarted = true
              }
            },
          }),
        ],
      },
    })

    await devServer.startAndWatch(ts)
    cleanup(() => devServer.close())

    await sleep(1000)

    assert.deepEqual(receivedMessages.length, 4)
  }).timeout(10_000)
})
