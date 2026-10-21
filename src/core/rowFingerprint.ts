// 刷新集合时判断记录是否变化。

import type { McpTool, NpcCharacter, WorldBook } from '../types/models';

/** 32 位 FNV-1a。 */
export function hashText(value: string | null | undefined): number {
  if (!value) return 0;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 小图直接做内容指纹；超过该长度的图片只比长度，避免刷新时扫描几 MB。 */
const IMAGE_FINGERPRINT_MAX_CHARS = 32 * 1024;

function imageFingerprint(url: string | null | undefined): string {
  if (!url) return '0';
  if (url.length > IMAGE_FINGERPRINT_MAX_CHARS) return `len:${url.length}`;
  return `hash:${url.length}:${hashText(url)}`;
}

/** 角色记录指纹（小头像做内容指纹，大图只比长度）。 */
export function npcFingerprint(n: NpcCharacter): string {
  return [
    n.id ?? 0,
    hashText(n.name),
    hashText(n.prompt),
    hashText(n.greeting),
    hashText(n.characterBook),
    hashText((n.alternateGreetings ?? []).join('\u0002')),
    imageFingerprint(n.avatarDataUrl),
    (n.enabledToolNames ?? []).join(','),
    n.avatarColorOrdinal ?? 0,
    n.isBuiltIn ? 1 : 0,
    n.isTavernKeeper ? 1 : 0,
  ].join('\u0001');
}

/** 世界书记录指纹（小配图做内容指纹，大图只比长度）。 */
export function worldBookFingerprint(b: WorldBook): string {
  return [
    b.id ?? 0,
    hashText(b.name),
    hashText(b.content),
    hashText(b.characterBook),
    imageFingerprint(b.imageUri),
    b.isBuiltIn ? 1 : 0,
  ].join('\u0001');
}

/** 技能记录指纹。 */
export function toolFingerprint(t: McpTool): string {
  return [
    t.id ?? 0,
    hashText(t.name),
    hashText(t.jsonContent),
    hashText(t.executionJson),
    t.isBuiltIn ? 1 : 0,
    t.origin ?? '',
    t.displayOrder ?? 0,
  ].join('\u0001');
}

/** 同长度且逐项指纹一致 → 视为没有变化（跳过写入，避免无谓的重新渲染）。 */
export function sameRows<T>(prev: T[], next: T[], fingerprint: (row: T) => string): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i] !== next[i] && fingerprint(prev[i]) !== fingerprint(next[i])) return false;
  }
  return true;
}
