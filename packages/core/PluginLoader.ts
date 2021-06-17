/* eslint-disable no-restricted-globals */
import domLoadScript from 'load-script2'

import { PluginConstructor } from './Plugin'
import { ConfigurationSchema } from './configuration'

import ReExports from './ReExports'

export const PluginSourceConfigurationSchema = ConfigurationSchema(
  'PluginSource',
  {
    name: {
      type: 'string',
      defaultValue: '',
    },
    url: {
      type: 'string',
      defaultValue: '',
    },
  },
)

export interface PluginDefinition {
  url: string
}

export interface PluginRecord {
  plugin: PluginConstructor
  definition: PluginDefinition
}

export default class PluginLoader {
  definitions: PluginDefinition[] = []

  constructor(pluginDefinitions: PluginDefinition[] = []) {
    this.definitions = JSON.parse(JSON.stringify(pluginDefinitions))
  }

  loadScript(scriptUrl: string): Promise<void> {
    if (document && document.getElementsByTagName) {
      return domLoadScript(scriptUrl)
    }
    // @ts-ignore
    if (self && self.importScripts) {
      return new Promise((resolve, reject) => {
        try {
          // @ts-ignore
          self.importScripts(scriptUrl)
        } catch (error) {
          reject(error || new Error(`failed to load ${scriptUrl}`))
          return
        }
        resolve()
      })
    }
    throw new Error(
      'cannot figure out how to load external JS scripts in this environment',
    )
  }

  async loadPlugin(definition: PluginDefinition): Promise<PluginConstructor> {
    const parsedUrl = new URL(definition.url)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(
        `cannot load plugins using protocol "${parsedUrl.protocol}"`,
      )
    }
    const plugin = (await import(/* webpackIgnore: true */ parsedUrl.href)) as {
      default: PluginConstructor
    }
    return plugin.default
  }

  installGlobalReExports(target: WindowOrWorkerGlobalScope | NodeJS.Global) {
    // @ts-ignore
    target.JBrowseExports = {}
    Object.entries(ReExports).forEach(([moduleName, module]) => {
      // @ts-ignore
      target.JBrowseExports[moduleName] = module
    })
  }

  async load(): Promise<PluginRecord[]> {
    return Promise.all(
      this.definitions.map(async definition => ({
        plugin: await this.loadPlugin(definition),
        definition,
      })),
    )
  }
}
