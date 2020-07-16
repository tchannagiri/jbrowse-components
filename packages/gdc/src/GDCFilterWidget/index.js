import { observer } from 'mobx-react'
import { ConfigurationSchema } from '@gmod/jbrowse-core/configuration'

export { default as ReactComponent } from './components/GDCFilterComponent'
export { default as stateModelFactory } from './model'
export const configSchema = ConfigurationSchema('GDCFilterWidget', {})
export const HeadingComponent = observer(() => {
  return 'GDC Filters'
})