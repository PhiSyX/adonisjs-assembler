/*
 * @adonisjs/assembler
 *
 * (c) AdonisJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import fs from 'fs-extra'
import slash from 'slash'
import copyfiles from 'cpy'
import { execa } from 'execa'
import { join, relative } from 'node:path'
import type tsStatic from 'typescript'
import { fileURLToPath } from 'node:url'
import { ConfigParser } from '@poppinss/chokidar-ts'
import { cliui, type Logger } from '@poppinss/cliui'

import type { BundlerOptions } from './types.js'

/**
 * Instance of CLIUI
 */
const ui = cliui()

/**
 * The bundler class exposes the API to build an AdonisJS project.
 */
export class Bundler {
  #cwd: URL
  #cwdPath: string
  #ts: typeof tsStatic
  #logger = ui.logger
  #options: BundlerOptions

  /**
   * Getting reference to colors library from logger
   */
  get #colors() {
    return this.#logger.getColors()
  }

  constructor(cwd: URL, ts: typeof tsStatic, options: BundlerOptions) {
    this.#cwd = cwd
    this.#cwdPath = fileURLToPath(this.#cwd)
    this.#ts = ts
    this.#options = options
  }

  #getRelativeName(filePath: string) {
    return slash(relative(this.#cwdPath, filePath))
  }

  /**
   * Cleans up the build directory
   */
  async #cleanupBuildDirectory(outDir: string) {
    await fs.remove(outDir)
  }

  /**
   * Runs tsc command to build the source.
   */
  async #runTsc(outDir: string) {
    try {
      await execa('tsc', ['--outDir', outDir], {
        cwd: this.#cwd,
        preferLocal: true,
        localDir: this.#cwd,
        windowsHide: false,
        buffer: false,
        stdio: 'inherit',
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Copy files to destination directory
   */
  async #copyFiles(files: string[], outDir: string) {
    try {
      await copyfiles(files, outDir, { cwd: this.#cwdPath })
    } catch (error) {
      if (!error.message.includes("the file doesn't exist")) {
        throw error
      }
    }
  }

  /**
   * Copy meta files to the output directory
   */
  async #copyMetaFiles(outDir: string, additionalFilesToCopy: string[]) {
    const metaFiles = (this.#options.metaFiles || [])
      .map((file) => file.pattern)
      .concat(additionalFilesToCopy)

    await this.#copyFiles(metaFiles, outDir)
  }

  /**
   * Copies .adonisrc.json file to the destination
   */
  async #copyAdonisRcFile(outDir: string) {
    const existingContents = await fs.readJSON(join(this.#cwdPath, '.adonisrc.json'))
    const compiledContents = Object.assign({}, existingContents, {
      typescript: false,
      lastCompiledAt: new Date().toISOString(),
    })

    await fs.outputJSON(join(outDir, '.adonisrc.json'), compiledContents, { spaces: 2 })
  }

  /**
   * Returns the lock file name for a given packages client
   */
  #getClientLockFile(client: 'npm' | 'yarn' | 'pnpm') {
    switch (client) {
      case 'npm':
        return 'package-lock.json'
      case 'yarn':
        return 'yarn.lock'
      case 'pnpm':
        return 'pnpm-lock.yaml'
    }
  }

  /**
   * Returns the installation command for a given packages client
   */
  #getClientInstallCommand(client: 'npm' | 'yarn' | 'pnpm') {
    switch (client) {
      case 'npm':
        return 'npm ci --omit="dev"'
      case 'yarn':
        return 'yarn install --production'
      case 'pnpm':
        return 'pnpm i --prod'
    }
  }

  /**
   * Set a custom CLI UI logger
   */
  setLogger(logger: Logger) {
    this.#logger = logger
    return this
  }

  /**
   * Bundles the application to be run in production
   */
  async bundle(
    stopOnError: boolean = true,
    client: 'npm' | 'yarn' | 'pnpm' = 'npm'
  ): Promise<boolean> {
    /**
     * Step 1: Parse config file to get the build output directory
     */
    const { config, error } = new ConfigParser(this.#cwd, 'tsconfig.json', this.#ts).parse()
    if (error) {
      const compilerHost = this.#ts.createCompilerHost({})
      this.#logger.logError(this.#ts.formatDiagnosticsWithColorAndContext([error], compilerHost))
      return false
    }

    if (config!.errors.length) {
      const compilerHost = this.#ts.createCompilerHost({})
      this.#logger.logError(
        this.#ts.formatDiagnosticsWithColorAndContext(config!.errors, compilerHost)
      )
      return false
    }

    if (!config) {
      return false
    }

    /**
     * Step 2: Cleanup existing build directory (if any)
     */
    const outDir = config.options.outDir || fileURLToPath(new URL('build/', this.#cwd))
    this.#logger.info('cleaning up output directory', { suffix: this.#getRelativeName(outDir) })
    await this.#cleanupBuildDirectory(outDir)

    /**
     * Step 3: Build typescript source code
     */
    this.#logger.info('compiling typescript source', { suffix: 'tsc' })
    const buildCompleted = await this.#runTsc(outDir)
    await this.#copyFiles(['ace.js'], outDir)

    /**
     * Remove incomplete build directory when tsc build
     * failed and stopOnError is set to true.
     */
    if (!buildCompleted && stopOnError) {
      await this.#cleanupBuildDirectory(outDir)
      const instructions = ui
        .sticker()
        .fullScreen()
        .drawBorder((borderChar, colors) => colors.red(borderChar))

      instructions.add(
        this.#colors.red('Cannot complete the build process as there are TypeScript errors.')
      )
      instructions.add(
        this.#colors.red(
          'Use "--ignore-ts-errors" flag to ignore TypeScript errors and continue the build.'
        )
      )

      this.#logger.logError(instructions.prepare())
      return false
    }

    /**
     * Step 4: Copy meta files to the build directory
     */
    const pkgFiles = ['package.json', this.#getClientLockFile(client)]
    this.#logger.info('copying meta files to the output directory')
    await this.#copyMetaFiles(outDir, pkgFiles)

    /**
     * Step 5: Copy .adonisrc.json file to the build directory
     */
    this.#logger.info('copying .adonisrc.json file to the output directory')
    await this.#copyAdonisRcFile(outDir)

    this.#logger.success('build completed')
    this.#logger.log('')

    ui.instructions()
      .useRenderer(this.#logger.getRenderer())
      .heading('Run the following commands to start the server in production')
      .add(this.#colors.cyan(`cd ${this.#getRelativeName(outDir)}`))
      .add(this.#colors.cyan(this.#getClientInstallCommand(client)))
      .add(this.#colors.cyan('node bin/server.js'))
      .render()

    return true
  }
}