import FileBrowser from '../common/FileBrowser'
import type { FileBrowserOptions } from '../common/FileBrowser'

const OPTIONS: FileBrowserOptions = {
  app: 'drive',
  title: 'Drive',
  noun: 'document',
  folderNoun: 'folder',
  view: 'list',
  encryption: true,
  textDocuments: true,
}

export default function Drive() {
  return <FileBrowser options={OPTIONS} />
}
