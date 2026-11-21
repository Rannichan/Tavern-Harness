export const IMAGE_MODELS = [
  'qwen-image-3.0-pro',
  'qwen-image-2.0-pro',
  'qwen-image-2.0',
  'wan2.7-image',
  'wan2.7-image-pro',
] as const;

interface GenerateImageResult {
  dataUrl: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

export async function generateImage(
  providerId: number,
  prompt: string,
  model: string,
  size = '1024*1024',
): Promise<GenerateImageResult> {
  const response = await fetch('/api-v3/image/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, prompt, model, size }),
  });
  const payload = await response.json().catch(() => null) as (GenerateImageResult & { message?: string }) | null;
  if (!response.ok || !payload?.dataUrl) {
    throw new Error(payload?.message || `Image generation failed (HTTP ${response.status})`);
  }
  return payload;
}
