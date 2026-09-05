import { db } from '../db/database';
import type { NpcCharacter, WorldBook } from '../types/models';

// ============================================================
// SillyTavern PNG 角色卡导入（chara v2 / ccv3 tEXt 块）
// ============================================================

export interface SillyTavernImportResult {
  characterName: string | null;
  worldBookName: string | null;
  version: string | null;
}

interface StV3Data {
  spec?: string;
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  character_book?: {
    name?: string;
    entries?: Array<{
      enabled?: boolean;
      name?: string;
      comment?: string;
      keys?: string[];
      content?: string;
    }>;
  };
  avatar?: string;
}

interface StV2Data {
  spec?: string;
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  character_book?: StV3Data['character_book'];
}

const MAX_PNG_SIZE = 8 * 1024 * 1024;

/** 解析 PNG tEXt 块（chara / ccv3）返回 JSON */
export function parsePngChara(buffer: ArrayBuffer): { key: 'ccv3' | 'chara'; data: StV3Data | StV2Data } | null {
  if (buffer.byteLength > MAX_PNG_SIZE) throw new Error('PNG 文件超过 8MB');
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);

  // PNG 签名校验
  if (
    bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a
  ) {
    throw new Error('不是合法的 PNG 文件');
  }

  let offset = 8;
  let ccv3: string | null = null;
  let chara: string | null = null;

  while (offset + 8 <= buffer.byteLength) {
    const length = dv.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.byteLength) break;

    if (type === 'tEXt') {
      // keyword\0text
      let sep = dataStart;
      while (sep < dataEnd && bytes[sep] !== 0) sep++;
      const keyword = latin1Decode(bytes.subarray(dataStart, sep));
      const text = latin1Decode(bytes.subarray(sep + 1, dataEnd));
      if (keyword === 'ccv3') ccv3 = text;
      else if (keyword === 'chara') chara = text;

      // CRC 校验（跳过实现细节，容错）
    }
    offset = dataEnd + 4; // 跳过 CRC
    if (type === 'IEND') break;
  }

  // 优先 ccv3
  for (const [key, val] of [
    ['ccv3', ccv3],
    ['chara', chara],
  ] as const) {
    if (val) {
      try {
        const data = JSON.parse(val) as StV3Data | StV2Data;
        return { key, data };
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

function latin1Decode(bytes: Uint8Array): string {
  // Puppeteer 导出的 chara 常为 UTF-8；依次尝试 UTF-8 再退 Latin-1
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
}

function decodeBase64Png(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(',')[1] ?? dataUrl;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** 从 SillyTavern 结构化字段组装人设 prompt（与 App 一致） */
function buildPromptFromStructured(data: StV3Data | StV2Data, fallbackName: string): string {
  const sections: Array<[string, string | undefined]> = [
    ['角色描述', data.description],
    ['性格', data.personality],
    ['场景', data.scenario],
    ['示例对话', data.mes_example],
    ['系统提示词', data.system_prompt],
    ['历史后指令', data.post_history_instructions],
  ];
  const parts = sections
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `### ${k}\n${v}`);
  if (parts.length === 0) return `你是${fallbackName}。`;
  return parts.join('\n\n');
}

/** 导入角色卡：创建角色（重名自动加后缀）与可选世界书 */
export async function importSillyTavernCard(file: File): Promise<SillyTavernImportResult> {
  const buffer = await file.arrayBuffer();
  const parsed = parsePngChara(buffer);
  if (!parsed) throw new Error('未找到角色卡数据（ccv3 / chara）');

  const { key, data } = parsed;
  const name = data.name?.trim() || '未命名角色';
  const greeting = data.first_mes ?? '';

  // 重名加后缀
  let finalName = name;
  let suffix = 2;
  while (await db.npcs.where('name').equals(finalName).first()) {
    finalName = `${name} (${suffix})`;
    suffix++;
  }

  const avatarDataUrl = extractAvatarFromCard(buffer, data);

  const npc: NpcCharacter = {
    name: finalName,
    prompt: buildPromptFromStructured(data, name),
    greeting: greeting.slice(0, 1000),
    avatarColorOrdinal: Math.floor(Math.random() * 6),
    avatarDataUrl,
    enabledToolNames: [],
    isBuiltIn: false,
    createdAt: Date.now(),
  };
  const npcId = await db.npcs.add(npc);

  let worldBookName: string | null = null;
  const book = data.character_book;
  if (book && Array.isArray(book.entries) && book.entries.length > 0) {
    const entries = book.entries.filter(
      (e) => e.enabled !== false && e.content && e.content.trim()
    );
    if (entries.length > 0) {
      const rendered = entries
        .map(
          (e) =>
            `### ${e.name || e.comment || '条目'}\n` +
            (e.keys && e.keys.length > 0 ? `触发词：${e.keys.join('、')}\n` : '') +
            e.content
        )
        .join('\n\n');
      const bookName = (book.name || `${name} 的世界书`).slice(0, 60);
      let finalBookName = bookName;
      let bs = 2;
      while (await db.worldBooks.where('name').equals(finalBookName).first()) {
        finalBookName = `${bookName} (${bs})`;
        bs++;
      }
      const wb: WorldBook = {
        name: finalBookName,
        content: rendered.slice(0, 10_000),
        imageUri: null,
        createdAt: Date.now(),
      };
      worldBookName = finalBookName;
      await db.worldBooks.add(wb);
    }
  }

  return {
    characterName: npc.name,
    worldBookName,
    version: key === 'ccv3' ? 'v3' : 'v2',
  };
}

function extractAvatarFromCard(buffer: ArrayBuffer, data: StV3Data | StV2Data): string | null {
  // 优先卡片内嵌的 avatar data URL（v3 特有）
  const avatarUrl = (data as StV3Data).avatar;
  if (avatarUrl && avatarUrl.startsWith('data:image/')) {
    return avatarUrl.slice(0, 2_000_000); // 控制存储体积
  }
  return null;
}

export function importSillyTavernFromDataUrl(dataUrl: string): Promise<SillyTavernImportResult> {
  const buffer = decodeBase64Png(dataUrl);
  const parsed = parsePngChara(buffer);
  if (!parsed) throw new Error('未找到角色卡数据');
  const { key, data } = parsed;
  // 复用主体逻辑（构造为文件导入流程的变体）
  return (async () => {
    const name = data.name?.trim() || '未命名角色';
    const greeting = data.first_mes ?? '';
    let finalName = name;
    let suffix = 2;
    while (await db.npcs.where('name').equals(finalName).first()) {
      finalName = `${name} (${suffix})`;
      suffix++;
    }
    const npc: NpcCharacter = {
      name: finalName,
      prompt: buildPromptFromStructured(data, name),
      greeting: greeting.slice(0, 1000),
      avatarColorOrdinal: Math.floor(Math.random() * 6),
      avatarDataUrl: extractAvatarFromCard(buffer, data),
      enabledToolNames: [],
      isBuiltIn: false,
      createdAt: Date.now(),
    };
    await db.npcs.add(npc);
    let worldBookName: string | null = null;
    if (data.character_book && data.character_book.entries?.length) {
      const entries = data.character_book.entries.filter((e) => e.enabled !== false && e.content?.trim());
      if (entries.length > 0) {
        const rendered = entries
          .map((e) => `### ${e.name || e.comment || '条目'}\n${e.keys?.length ? `触发词：${e.keys.join('、')}\n` : ''}${e.content}`)
          .join('\n\n');
        worldBookName = data.character_book.name || `${name} 的世界书`;
        await db.worldBooks.add({
          name: worldBookName.slice(0, 60),
          content: rendered.slice(0, 10_000),
          imageUri: null,
          createdAt: Date.now(),
        });
      }
    }
    return { characterName: npc.name, worldBookName, version: key === 'ccv3' ? 'v3' : 'v2' };
  })();
}