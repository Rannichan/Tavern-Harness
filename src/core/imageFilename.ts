const MAX_IMAGE_FILENAME_LENGTH = 64;

function readableStem(value: string): string {
  const withoutImageExtension = value.trim().replace(/\.(?:png|jpe?g|gif|webp|bmp)$/i, '');
  const normalized = withoutImageExtension
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return Array.from(normalized).slice(0, MAX_IMAGE_FILENAME_LENGTH).join('').replace(/[-_]+$/g, '');
}

export function buildGeneratedImagePath(
  requestedFilename: string,
  prompt: string,
  extension: string,
  timestamp = Date.now()
): string {
  const stem = readableStem(requestedFilename) || readableStem(prompt) || 'generated';
  return `images/${stem}-${timestamp}.${extension}`;
}
