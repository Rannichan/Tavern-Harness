/** 缓存大尺寸位图头像的展示缩略图。 */
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';

/** 超过该长度的 data URL 才值得缩略（约 72 KB 图片；再小的解析成本可忽略）。 */
export const AVATAR_THUMBNAIL_THRESHOLD = 96 * 1024;

/** 缩略图边长：最大展示尺寸 40px，128px 足够覆盖 3x DPR。 */
const AVATAR_THUMBNAIL_SIZE = 128;

/** 入库缩略图边长：比展示尺寸大一档，兼顾高 DPI 与二次导出。 */
export const AVATAR_STORAGE_SIZE = 256;

/** 缓存条数 + 总字符双上限：原图 data URL 作为 key 时，单条也可能很大。 */
const CACHE_LIMIT = 128;
const CACHE_MAX_CHARS = 4 * 1024 * 1024;

/** 可安全缩略的位图 data URL；GIF/SVG 跳过（保留动图与矢量）。 */
const THUMBNAILABLE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|bmp|avif);base64,/i;

type ThumbnailState =
  | { status: 'pending'; thumb: null }
  | { status: 'ready'; thumb: string }
  | { status: 'original'; thumb: null };

const cache = new Map<string, ThumbnailState>();
/** 当前挂载中的头像 URL：正在显示的条目不允许被预算淘汰，否则会“文字头像 ⇄ 图片头像”反复闪。 */
const activeUrls = new Map<string, number>();
const listeners = new Set<() => void>();
const queue: string[] = [];
const queued = new Set<string>();
let cachedChars = 0;
let pumping = false;

/** 是否是值得生成缩略图的超大位图 data URL。 */
export function isOversizedAvatarUrl(url: string | null | undefined): boolean {
  return Boolean(url && url.length > AVATAR_THUMBNAIL_THRESHOLD && THUMBNAILABLE_DATA_URL.test(url));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

function entryChars(url: string, state: ThumbnailState): number {
  return url.length + (state.thumb?.length ?? 0);
}

function setCacheEntry(url: string, state: ThumbnailState): void {
  const previous = cache.get(url);
  if (previous) cachedChars -= entryChars(url, previous);
  cache.set(url, state);
  cachedChars += entryChars(url, state);
}

function deleteCacheEntry(url: string): void {
  const entry = cache.get(url);
  if (!entry) return;
  cachedChars -= entryChars(url, entry);
  cache.delete(url);
}

function trimCache(): void {
  while ((cache.size > CACHE_LIMIT || cachedChars > CACHE_MAX_CHARS) && cache.size > 1) {
    // 只淘汰已经不在界面上的条目；全部都在用时宁可暂时超出预算，
    // 否则刚生成好的缩略图会被立刻删掉，然后又在同一个组件里重建。
    let victim: string | undefined;
    for (const key of cache.keys()) {
      if (!activeUrls.has(key)) {
        victim = key;
        break;
      }
    }
    if (victim == null) break;
    deleteCacheEntry(victim);
  }
}

/** 命中即移到队尾（Map 的插入顺序就是淘汰顺序）。 */
function touchCacheEntry(url: string): void {
  const entry = cache.get(url);
  if (!entry) return;
  cache.delete(url);
  cache.set(url, entry);
}

function requestIdle(callback: () => void): void {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === 'function') {
    idle(callback, { timeout: 500 });
    return;
  }
  globalThis.setTimeout(callback, 50);
}

function enqueue(url: string): void {
  if (cache.has(url) || queued.has(url)) return;
  setCacheEntry(url, { status: 'pending', thumb: null });
  trimCache();
  queue.push(url);
  queued.add(url);
  if (!pumping) {
    pumping = true;
    requestIdle(() => void pump());
  }
}

async function pump(): Promise<void> {
  const url = queue.shift();
  if (url) queued.delete(url);
  if (!url) {
    pumping = false;
    return;
  }
  // 排队期间可能已被缓存淘汰：补回 pending，避免同一 URL 永远没有结果
  if (!cache.has(url)) {
    setCacheEntry(url, { status: 'pending', thumb: null });
    trimCache();
  }
  try {
    const thumb = await renderThumbnail(url, AVATAR_THUMBNAIL_SIZE);
    setCacheEntry(url, { status: 'ready', thumb });
  } catch {
    // 解码失败（损坏图片 / 不支持的格式）就退回原图，不反复重试
    setCacheEntry(url, { status: 'original', thumb: null });
  }
  notify();
  trimCache();
  if (queue.length > 0) {
    // 逐个错开：连续生成多张大图时给浏览器留出渲染/交互的间隙
    globalThis.setTimeout(() => requestIdle(() => void pump()), 80);
    return;
  }
  pumping = false;
}

/**
 * 生成缩略图 data URL（仅浏览器可用）。
 * 用 createImageBitmap 的 resize 选项把缩放交给解码器，避免 drawImage 大幅缩小
 * 时在主线程上做昂贵的重采样；不支持时退回 drawImage。
 */
async function renderThumbnail(dataUrl: string, size: number): Promise<string> {
  const image = new Image();
  image.decoding = 'async';
  image.src = dataUrl;
  await image.decode();

  // 与 CSS 的 background-size: cover 一致：先按短边居中裁出正方形，再缩放。
  // 直接拉成 128×128 会把非正方形头像压扁/拉长。
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const side = Math.max(1, Math.min(width, height));
  const sx = Math.max(0, Math.round((width - side) / 2));
  const sy = Math.max(0, Math.round((height - side) / 2));

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  // 必须使用软件（CPU）画布：GPU 画布第一次 toDataURL 需要同步读回，
  // 实测单张 128px 缩略图会阻塞主线程 80–250 ms，几张卡叠起来就是将近 1 s。
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  // 用 createImageBitmap 的裁剪 + resize 选项把缩放交给解码器，避免 drawImage
  // 在主线程上对 4096px 原图做昂贵的重采样；不支持时退回 drawImage 的裁剪重载。
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(image, sx, sy, side, side, { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
  } catch {
    bitmap = null;
  }
  if (bitmap) {
    context.drawImage(bitmap, 0, 0, size, size);
    bitmap.close();
  } else {
    context.drawImage(image, sx, sy, side, side, 0, 0, size, size);
  }

  // 优先 WebP（体积小且支持透明）；浏览器不支持时会自动退回 PNG
  const webp = canvas.toDataURL('image/webp', 0.82);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

/**
 * 把超大头像压成缩略图；非超大 / 非位图 / 失败时原样返回。
 * 用于导入角色卡、上传头像，避免把整张原图继续写进数据库。
 */
export async function shrinkAvatarDataUrl(dataUrl: string | null | undefined, size = AVATAR_STORAGE_SIZE): Promise<string | null> {
  if (!dataUrl || !isOversizedAvatarUrl(dataUrl)) return dataUrl ?? null;
  try {
    return await renderThumbnail(dataUrl, size);
  } catch {
    return dataUrl;
  }
}

/**
 * 展示用头像 URL：
 * - 普通头像直接返回原 URL；
 * - 超大 data URL 返回缩略图；缩略图还没生成好时返回 null（调用方显示备用头像）。
 */
export function useAvatarImageUrl(imageUrl: string | null | undefined): string | null {
  const oversized = isOversizedAvatarUrl(imageUrl);
  const displayUrl = useSyncExternalStore(
    subscribe,
    () => {
      if (!imageUrl) return null;
      if (!oversized) return imageUrl;
      const entry = cache.get(imageUrl);
      if (entry?.status === 'ready') return entry.thumb;
      if (entry?.status === 'original') return imageUrl;
      return null;
    },
    () => null,
  );

  // 在布局阶段登记「仍在使用」：所有卡片的登记都完成后，被动 effect 才开始
  // 请求缩略图，避免批量挂载时把尚未登记的条目误当成可淘汰对象。
  useLayoutEffect(() => {
    if (!imageUrl || !oversized) return;
    activeUrls.set(imageUrl, (activeUrls.get(imageUrl) ?? 0) + 1);
    return () => {
      const count = activeUrls.get(imageUrl);
      if (count == null) return;
      if (count <= 1) activeUrls.delete(imageUrl);
      else activeUrls.set(imageUrl, count - 1);
    };
  }, [imageUrl, oversized]);

  useEffect(() => {
    if (!imageUrl || !oversized) return;
    // 命中后移到队尾；被淘汰后再补一次生成请求（displayUrl 也在依赖里）。
    if (cache.has(imageUrl)) touchCacheEntry(imageUrl);
    else enqueue(imageUrl);
  }, [imageUrl, oversized, displayUrl]);

  return displayUrl;
}
