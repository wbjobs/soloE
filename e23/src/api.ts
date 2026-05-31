import { invoke } from '@tauri-apps/api/tauri'
import { Note } from './types'

export async function getNotes(): Promise<Note[]> {
  return await invoke<Note[]>('get_notes')
}

export async function createNote(title: string, content: string): Promise<Note> {
  return await invoke<Note>('create_note', { title, content })
}

export async function updateNote(id: number, title: string, content: string): Promise<Note> {
  return await invoke<Note>('update_note', { id, title, content })
}

export async function deleteNote(id: number): Promise<void> {
  return await invoke<void>('delete_note', { id })
}
