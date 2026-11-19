// Téléchargement local d'un fichier généré dans le navigateur.

export function downloadBlob(blob: Blob, fileName: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Nom de fichier sûr (sans caractères interdits). */
export function safeName(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 80);
}

export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
