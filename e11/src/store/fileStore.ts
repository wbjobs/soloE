import { create } from "zustand"

export interface FileInfo {
  name: string
  path: string
  size: number
  modified: string
  is_encrypted: boolean
}

interface FileStore {
  files: FileInfo[]
  selectedFiles: Set<string>
  currentFolder: string | null
  setFiles: (files: FileInfo[]) => void
  setCurrentFolder: (folder: string | null) => void
  toggleFileSelection: (path: string) => void
  clearSelection: () => void
  selectAll: () => void
}

export const useFileStore = create<FileStore>((set) => ({
  files: [],
  selectedFiles: new Set(),
  currentFolder: null,
  setFiles: (files) => set({ files }),
  setCurrentFolder: (folder) => set({ currentFolder: folder }),
  toggleFileSelection: (path) =>
    set((state) => {
      const newSelected = new Set(state.selectedFiles)
      if (newSelected.has(path)) {
        newSelected.delete(path)
      } else {
        newSelected.add(path)
      }
      return { selectedFiles: newSelected }
    }),
  clearSelection: () => set({ selectedFiles: new Set() }),
  selectAll: () =>
    set((state) => ({
      selectedFiles: new Set(state.files.map((f) => f.path)),
    })),
}))
