import assemblyManagerFactory, {
  assemblyConfigSchemas as AssemblyConfigSchemasFactory,
} from '@jbrowse/core/assemblyManager'
import PluginManager from '@jbrowse/core/PluginManager'
import RpcManager from '@jbrowse/core/rpc/RpcManager'
import { MenuItem } from '@jbrowse/core/ui'
import AddIcon from '@material-ui/icons/Add'
import SettingsIcon from '@material-ui/icons/Settings'
import AppsIcon from '@material-ui/icons/Apps'
import {
  cast,
  getParent,
  getSnapshot,
  SnapshotIn,
  types,
} from 'mobx-state-tree'
import JBrowseDesktop from './jbrowseModel'
import sessionModelFactory from './sessionModelFactory'

const { electronBetterIpc = {} } = window
const ipcRenderer = (electronBetterIpc && electronBetterIpc.ipcRenderer) || {
  invoke: () => {},
}
interface Menu {
  label: string
  menuItems: MenuItem[]
}

export default function RootModel(pluginManager: PluginManager) {
  const { assemblyConfigSchemas, dispatcher } = AssemblyConfigSchemasFactory(
    pluginManager,
  )
  const assemblyConfigSchemasType = types.union(
    { dispatcher },
    ...assemblyConfigSchemas,
  )
  const Session = sessionModelFactory(pluginManager, assemblyConfigSchemasType)
  const assemblyManagerType = assemblyManagerFactory(
    assemblyConfigSchemasType,
    pluginManager,
  )
  return types
    .model('Root', {
      jbrowse: JBrowseDesktop(
        pluginManager,
        Session,
        assemblyConfigSchemasType,
      ),
      session: types.maybe(Session),
      assemblyManager: assemblyManagerType,
      error: types.maybe(types.string),
      savedSessionNames: types.maybe(types.array(types.string)),
      version: types.maybe(types.string),
      isAssemblyEditing: false,
    })
    .volatile(() => ({
      pluginsUpdated: false,
    }))
    .actions(self => ({
      setSavedSessionNames(sessionNames: string[]) {
        self.savedSessionNames = cast(sessionNames)
      },
      setSession(sessionSnapshot?: SnapshotIn<typeof Session>) {
        self.session = cast(sessionSnapshot)
      },
      setDefaultSession() {
        this.setSession({
          ...self.jbrowse.defaultSession,
          name: `${
            self.jbrowse.defaultSession.name
          } ${new Date().toLocaleString()}`,
        })
      },
      setAssemblyEditing(flag: boolean) {
        self.isAssemblyEditing = flag
      },
      setPluginsUpdated(flag: boolean) {
        self.pluginsUpdated = flag
      },
      renameCurrentSession(sessionName: string) {
        if (self.session) {
          const snapshot = JSON.parse(JSON.stringify(getSnapshot(self.session)))
          const oldName = snapshot.name
          snapshot.name = sessionName
          this.setSession(snapshot)
          ipcRenderer.invoke('renameSession', oldName, sessionName)
        }
      },
      duplicateCurrentSession() {
        if (self.session) {
          const snapshot = JSON.parse(JSON.stringify(getSnapshot(self.session)))
          let newSnapshotName = `${self.session.name} (copy)`
          if (self.jbrowse.savedSessionNames.includes(newSnapshotName)) {
            let newSnapshotCopyNumber = 2
            do {
              newSnapshotName = `${self.session.name} (copy ${newSnapshotCopyNumber})`
              newSnapshotCopyNumber += 1
            } while (self.jbrowse.savedSessionNames.includes(newSnapshotName))
          }
          snapshot.name = newSnapshotName
          this.setSession(snapshot)
        }
      },
    }))
    .volatile(self => ({
      history: {},
      menus: [
        {
          label: 'File',
          menuItems: [
            {
              label: 'New Session',
              icon: AddIcon,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick: (session: any) => {
                session.setDefaultSession()
              },
            },
            {
              label: 'Return to splash screen',
              icon: AppsIcon,
              onClick: () => {
                self.setSession(undefined)
              },
            },
          ],
        },
        {
          label: 'Edit',
          menuItems: [
            {
              label: 'Open assembly manager',
              icon: SettingsIcon,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick: (session: any) => {
                const rootModel = getParent(session)
                rootModel.setAssemblyEditing(true)
              },
            },
          ],
        },
      ] as Menu[],
      rpcManager: new RpcManager(
        pluginManager,
        self.jbrowse.configuration.rpc,
        {
          ElectronRpcDriver: { workerCreationChannel: 'createWindowWorker' },
        },
      ),
      adminMode: true,
    }))
    .actions(self => ({
      activateSession(sessionSnapshot: SnapshotIn<typeof Session>) {
        self.setSession(sessionSnapshot)
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setHistory(history: any) {
        self.history = history
      },
      setMenus(newMenus: Menu[]) {
        self.menus = newMenus
      },
      /**
       * Add a top-level menu
       * @param menuName - Name of the menu to insert.
       * @returns The new length of the top-level menus array
       */
      appendMenu(menuName: string) {
        return self.menus.push({ label: menuName, menuItems: [] })
      },
      /**
       * Insert a top-level menu
       * @param menuName - Name of the menu to insert.
       * @param position - Position to insert menu. If negative, counts from th
       * end, e.g. `insertMenu('My Menu', -1)` will insert the menu as the
       * second-to-last one.
       * @returns The new length of the top-level menus array
       */
      insertMenu(menuName: string, position: number) {
        const insertPosition =
          position < 0 ? self.menus.length + position : position
        self.menus.splice(insertPosition, 0, { label: menuName, menuItems: [] })
        return self.menus.length
      },
      /**
       * Add a menu item to a top-level menu
       * @param menuName - Name of the top-level menu to append to.
       * @param menuItem - Menu item to append.
       * @returns The new length of the menu
       */
      appendToMenu(menuName: string, menuItem: MenuItem) {
        const menu = self.menus.find(m => m.label === menuName)
        if (!menu) {
          self.menus.push({ label: menuName, menuItems: [menuItem] })
          return 1
        }
        return menu.menuItems.push(menuItem)
      },
      /**
       * Insert a menu item into a top-level menu
       * @param menuName - Name of the top-level menu to insert into
       * @param menuItem - Menu item to insert
       * @param position - Position to insert menu item. If negative, counts
       * from the end, e.g. `insertMenu('My Menu', -1)` will insert the menu as
       * the second-to-last one.
       * @returns The new length of the menu
       */
      insertInMenu(menuName: string, menuItem: MenuItem, position: number) {
        const menu = self.menus.find(m => m.label === menuName)
        if (!menu) {
          self.menus.push({ label: menuName, menuItems: [menuItem] })
          return 1
        }
        const insertPosition =
          position < 0 ? menu.menuItems.length + position : position
        menu.menuItems.splice(insertPosition, 0, menuItem)
        return menu.menuItems.length
      },
      /**
       * Add a menu item to a sub-menu
       * @param menuPath - Path to the sub-menu to add to, starting with the
       * top-level menu (e.g. `['File', 'Insert']`).
       * @param menuItem - Menu item to append.
       * @returns The new length of the sub-menu
       */
      appendToSubMenu(menuPath: string[], menuItem: MenuItem) {
        let topMenu = self.menus.find(m => m.label === menuPath[0])
        if (!topMenu) {
          const idx = this.appendMenu(menuPath[0])
          topMenu = self.menus[idx - 1]
        }
        let { menuItems: subMenu } = topMenu
        const pathSoFar = [menuPath[0]]
        menuPath.slice(1).forEach(menuName => {
          pathSoFar.push(menuName)
          let sm = subMenu.find(mi => 'label' in mi && mi.label === menuName)
          if (!sm) {
            const idx = subMenu.push({ label: menuName, subMenu: [] })
            sm = subMenu[idx - 1]
          }
          if (!('subMenu' in sm)) {
            throw new Error(
              `"${menuName}" in path "${pathSoFar}" is not a subMenu`,
            )
          }
          subMenu = sm.subMenu
        })
        return subMenu.push(menuItem)
      },
      /**
       * Insert a menu item into a sub-menu
       * @param menuPath - Path to the sub-menu to add to, starting with the
       * top-level menu (e.g. `['File', 'Insert']`).
       * @param menuItem - Menu item to insert.
       * @param position - Position to insert menu item. If negative, counts
       * from the end, e.g. `insertMenu('My Menu', -1)` will insert the menu as
       * the second-to-last one.
       * @returns The new length of the sub-menu
       */
      insertInSubMenu(
        menuPath: string[],
        menuItem: MenuItem,
        position: number,
      ) {
        let topMenu = self.menus.find(m => m.label === menuPath[0])
        if (!topMenu) {
          const idx = this.appendMenu(menuPath[0])
          topMenu = self.menus[idx - 1]
        }
        let { menuItems: subMenu } = topMenu
        const pathSoFar = [menuPath[0]]
        menuPath.slice(1).forEach(menuName => {
          pathSoFar.push(menuName)
          let sm = subMenu.find(mi => 'label' in mi && mi.label === menuName)
          if (!sm) {
            const idx = subMenu.push({ label: menuName, subMenu: [] })
            sm = subMenu[idx - 1]
          }
          if (!('subMenu' in sm)) {
            throw new Error(
              `"${menuName}" in path "${pathSoFar}" is not a subMenu`,
            )
          }
          subMenu = sm.subMenu
        })
        subMenu.splice(position, 0, menuItem)
        return subMenu.length
      },
    }))
}
