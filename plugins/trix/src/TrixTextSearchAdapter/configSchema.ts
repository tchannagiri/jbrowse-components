import { ConfigurationSchema } from '@jbrowse/core/configuration'

export default ConfigurationSchema(
  'TrixTextSearchAdapter',
  {
    ixFilePath: {
      type: 'fileLocation',
      defaultValue: { uri: 'out.ix' },
      description: 'the location of the trix ix file',
    },
    ixxFilePath: {
      type: 'fileLocation',
      defaultValue: { uri: 'out.ixx' },
      description: 'the location of the trix ixx file',
    },
    tracks: {
      type: 'stringArray',
      defaultValue: [],
      description: 'List of tracks covered by text search adapter',
    },
    assemblies: {
      type: 'stringArray',
      defaultValue: [],
      description: 'List of assemblies covered by text search adapter',
    },
  },
  { explicitlyTyped: true, explicitIdentifier: 'textSearchAdapterId' },
)
