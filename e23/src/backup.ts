import { writeTextFile, createDir, readDir, readTextFile } from '@tauri-apps/api/fs'
import { documentDir, join } from '@tauri-apps/api/path'
import { Note } from './types'

const BACKUP_DIR = 'markdown-notes-backup'

export async function backupNote(note: Note): Promise<void> {
  try {
    const docDir = await documentDir()
    const backupDir = await join(docDir, BACKUP_DIR)
    
    try {
      await readDir(backupDir)
    } catch {
      await createDir(backupDir)
    }

    const fileName = `note_${note.id}_${note.title.replace(/[^a-zA-Z0-9]/g, '_')}.md`
    const filePath = await join(backupDir, fileName)
    
    const content = `# ${note.title}\n\n${note.content}\n\n---\nLast modified: ${note.last_modified}`
    await writeTextFile(filePath, content)
  } catch (error) {
    console.error('Backup failed:', error)
  }
}

export async function backupAllNotes(notes: Note[]): Promise<void> {
  for (const note of notes) {
    await backupNote(note)
  }
}
