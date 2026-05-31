import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

export interface YjsDocManagerOptions {
  docName: string;
  onUpdate?: (update: Uint8Array) => void;
}

export class YjsDocManager {
  private doc: Y.Doc;
  private persistence: IndexeddbPersistence;
  private text: Y.Text;
  private title: Y.Text;

  constructor(options: YjsDocManagerOptions) {
    this.doc = new Y.Doc({ guid: options.docName });
    this.text = this.doc.getText('content');
    this.title = this.doc.getText('title');
    
    this.persistence = new IndexeddbPersistence('notes', this.doc);
    
    if (options.onUpdate) {
      this.doc.on('update', options.onUpdate);
    }
  }

  getDoc(): Y.Doc {
    return this.doc;
  }

  getText(): Y.Text {
    return this.text;
  }

  getTitle(): Y.Text {
    return this.title;
  }

  getContent(): string {
    return this.text.toString();
  }

  getTitleContent(): string {
    return this.title.toString();
  }

  setContent(content: string): void {
    this.doc.transact(() => {
      this.text.delete(0, this.text.length);
      this.text.insert(0, content);
    });
  }

  setTitleContent(title: string): void {
    this.doc.transact(() => {
      this.title.delete(0, this.title.length);
      this.title.insert(0, title);
    });
  }

  applyUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update);
  }

  getState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  destroy(): void {
    this.persistence.destroy();
    this.doc.destroy();
  }

  whenSynced(): Promise<void> {
    return this.persistence.whenSynced;
  }
}

export function createNoteId(): string {
  return 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

export function mergeUpdates(updates: Uint8Array[]): Uint8Array {
  if (updates.length === 0) return new Uint8Array();
  if (updates.length === 1) return updates[0];
  return Y.mergeUpdates(updates);
}

export function uint8ArrayToBase64(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr));
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
