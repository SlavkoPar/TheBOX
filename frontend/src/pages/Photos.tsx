import FileBrowser from '../common/FileBrowser'
import type { FileBrowserOptions } from '../common/FileBrowser'

const OPTIONS: FileBrowserOptions = {
  app: 'photos',
  title: 'Photos',
  noun: 'photo',
  folderNoun: 'album',
  view: 'grid',
  accept: 'image/*',
  encryption: false,
  documents: false,
}

export default function Photos() {
  return <FileBrowser options={OPTIONS} />
}
