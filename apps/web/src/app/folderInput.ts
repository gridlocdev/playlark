/**
 * Picks a folder with `<input type="file" webkitdirectory>` (PRD §17): the way Firefox and Safari open a folder,
 * as they have no `showDirectoryPicker`. Gives every file under it, or null when the user cancelled.
 */
export function pickFolderFiles(doc: Document = document): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.hidden = true;
    const done = (files: File[] | null) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(input.files ? [...input.files] : null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    doc.body.append(input);
    input.click();
  });
}

/** True when this browser can pick a folder with the file input. */
export const canPickFolderFiles = (): boolean =>
  typeof HTMLInputElement !== 'undefined' && 'webkitdirectory' in HTMLInputElement.prototype;
