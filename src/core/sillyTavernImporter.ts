import type { NpcCharacter } from '../types/models';

// ============================================================
// SillyTavern PNG 角色卡导入（chara v2 / ccv3 tEXt 块）
// ============================================================
// 依据官方规范实现：
// - v2: https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md
//   JSON 结构为 { spec, spec_version, data: TavernCardV2 }，
//   PNG 嵌入的 chara 块内容是「把 JSON 字符串按 UTF-8 编码后，再整体做 base64」的结果
// - v3: https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md
//   PNG 嵌入的 ccv3 块内容同样是「JSON 字符串 utf-8 -> base64」

/** TavernCardV2 的 data 字段（v2 卡字段全部嵌套在 data 中） */
interface StDepthPrompt {
  prompt?: string;
}

interface TavernCardExtensions {
  depth_prompt?: StDepthPrompt;
  [key: string]: unknown;
}

interface TavernV2Data {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  alternate_greetings?: string[];
  character_book?: StLorebook;
  extensions?: TavernCardExtensions;
}

/** 顶层共有的信封结构（v2 用 spec='chara_card_v2'，v3 用 spec='chara_card_v3'） */
interface StEnvelope {
  /** v2 时存在：'chara_card_v2' */
  spec?: string;
  /** v3 时存在：'chara_card_v3' */
  spec_version?: string;
  /** v2 卡的 data 字段 */
  data?: TavernV2Data;
  // -------- v3 字段（CharacterCardV3 是 TavernCardV2 的超集，且字段就在顶层） --------
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  /** v3 的额外开场白（备用），创建对话时随机选用 */
  alternate_greetings?: string[];
  character_book?: StLorebook;
  extensions?: TavernCardExtensions;
  /** v3 的 assets 图标（可选 base64 data URL） */
  assets?: Array<{ type?: string; uri?: string; name?: string; ext?: string }>;
}

interface StLorebook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions?: Record<string, unknown>;
  entries?: Array<{
    enabled?: boolean;
    name?: string;
    comment?: string;
    keys?: string[];
    secondary_keys?: string[];
    content?: string;
    selective?: boolean;
    constant?: boolean;
    position?: 'before_char' | 'after_char';
  }>;
}

const MAX_PNG_SIZE = 20 * 1024 * 1024;

/** 尝试把字节解码为 UTF-8 文本 */
function utf8Decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // 退化为 latin1，保证不会抛错
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
}

/** 标准 base64 解码（返回 UTF-8 文本） */
function safeBase64Decode(text: string): string | null {
  const trimmed = text.replace(/\s/g, '');
  // 去掉可能残留的 data:...;base64, 前缀
  const commaIdx = trimmed.indexOf(',');
  const body = commaIdx >= 0 && /^data:[\w.+-]+\/[^;]+;base64$/i.test(trimmed.slice(0, commaIdx))
    ? trimmed.slice(commaIdx + 1)
    : trimmed;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body) || body.length % 4 === 1) return null;
  try {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return utf8Decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 解析 PNG tEXt 块（chara / ccv3）。
 * 返回归一化后的卡片数据：v2 卡会把 data 字段展开到顶层，与 v3 字段结构对齐。
 */
function parsePngChara(buffer: ArrayBuffer): { key: 'ccv3' | 'chara'; data: StEnvelope } | null {
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
      const keyword = utf8Decode(bytes.subarray(dataStart, sep));
      const rawText = bytes.subarray(sep + 1, dataEnd);
      if (keyword === 'ccv3') ccv3 = utf8Decode(rawText);
      else if (keyword === 'chara') chara = utf8Decode(rawText);
    }
    offset = dataEnd + 4; // 跳过 CRC
    if (type === 'IEND') break;
  }

  // 官方规范：tEXt 内容的 JSON 是 utf-8 -> base64 编码，先尝试 base64 解码再 JSON.parse
  const candidates: Array<{ key: 'ccv3' | 'chara'; raw: string | null }> = [
    { key: 'ccv3', raw: ccv3 },
    { key: 'chara', raw: chara },
  ];

  for (const { key, raw } of candidates) {
    if (!raw) continue;
    for (const text of [safeBase64Decode(raw), raw]) {
      if (!text) continue;
      try {
        const json = JSON.parse(text) as unknown;
        const data = normalizeCard(json);
        if (data) return { key, data };
      } catch {
        /* 尝试下一种解码 */
      }
    }
  }
  return null;
}

/**
 * 把规范里的两种信封结构归一化为统一的字段结构：
 * - v2: { spec, spec_version, data: {...} }  -> 展开 data
 * - v3: { spec, spec_version, ...顶层字段 }    -> 原样
 * 也兼容某些工具导出的「字段直接裸露在顶层」的 v2 变体。
 */
function normalizeCard(json: unknown): StEnvelope | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;

  // 情况一：有 data 字段（v2 规范信封）
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    const data = obj.data as Record<string, unknown>;
    return {
      spec: typeof obj.spec === 'string' ? obj.spec : undefined,
      spec_version: typeof obj.spec_version === 'string' ? obj.spec_version : undefined,
      ...(data as unknown as TavernV2Data),
    };
  }

  // 情况二：顶层直接是卡数据（v3 规范 / v2 变体）
  // 必须至少有一个角色字段，避免把乱码 JSON 误判成卡
  const hasCardField = ['name', 'description', 'personality', 'first_mes', 'scenario'].some(
    (k) => typeof obj[k] === 'string'
  );
  if (hasCardField) {
    return {
      spec: typeof obj.spec === 'string' ? obj.spec : undefined,
      spec_version: typeof obj.spec_version === 'string' ? obj.spec_version : undefined,
      ...(obj as unknown as TavernV2Data),
    };
  }

  return null;
}

/** 从 SillyTavern 结构化字段组装人设 prompt，并将字段内容保留为 Markdown 原文。 */
function normalizePlaceholders(text: string, characterName: string): string {
  const unsupportedPlaceholder = /\{\{\s*(?!user\s*\}\})[^{}]*\}\}/i;
  const standaloneLine = new RegExp(`^[\\t ]*${unsupportedPlaceholder.source}[\\t ]*(?:\\r?\\n|$)`, 'gim');
  return text
    .replace(/\{\{\s*char\s*\}\}/gi, () => characterName)
    .replace(standaloneLine, '')
    .replace(new RegExp(unsupportedPlaceholder.source, 'gi'), '');
}

function buildPromptFromStructured(data: StEnvelope, fallbackName: string): string {
  const extraInstructions = [
    data.post_history_instructions,
    data.extensions?.depth_prompt?.prompt,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n\n');
  const sections: Array<[string, string | undefined]> = [
    ['Character Description', data.description],
    ['Personality', data.personality],
    ['Scenario', data.scenario],
    ['Example Dialogue', data.mes_example],
    ['Extra Instructions', extraInstructions],
  ];
  const parts = sections
    .filter((section): section is [string, string] => Boolean(section[1]?.trim()))
    .map(([title, value]) => {
      const fenceLength = Math.max(3, ...(value.match(/`+/g) ?? []).map((run) => run.length + 1));
      const fence = '`'.repeat(fenceLength);
      return `## ${title}\n\n${fence}text\n${normalizePlaceholders(value, fallbackName)}\n${fence}`;
    });
  if (parts.length === 0) return `你是${fallbackName}。`;
  return parts.join('\n\n');
}

/** 从卡片内嵌资源中提取头像（v3 assets 里的 base64 data URL） */
function extractAvatarFromCard(data: StEnvelope): string | null {
  const icon = (data.assets ?? []).find((a) => a?.type === 'icon' && a?.uri?.startsWith('data:image/'));
  if (icon?.uri) return icon.uri.slice(0, 2_000_000); // 控制存储体积
  return null;
}

/** 把 PNG 文件字节转成 data URL（导入时作为角色头像的兜底来源） */
function pngToDataUrl(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:image/png;base64,${btoa(bin)}`;
}

/**
 * 解析头像：优先卡内 assets 图标（v3），否则直接用 PNG 文件本身作为头像。
 * 卡片 PNG 通常就是角色立绘/头像，保证几乎所有角色卡导入后都有头像。
 */
function resolveAvatar(data: StEnvelope, pngDataUrl: string | null): string | null {
  return extractAvatarFromCard(data) ?? pngDataUrl;
}

/** 渲染内嵌 Lorebook（character_book）为可读文本 */
function renderLorebook(book: StLorebook | undefined, characterName: string) {
  if (!book || !Array.isArray(book.entries)) return null;
  const entries = book.entries.filter((e) => e.enabled !== false && e.content && e.content.trim());
  if (entries.length === 0) return null;
  const rendered = entries
    .map(
      (e) =>
        `### ${normalizePlaceholders(e.name || e.comment || '条目', characterName)}\n` +
        (e.keys && e.keys.length > 0 ? `触发词：${normalizePlaceholders(e.keys.join('、'), characterName)}\n` : '') +
        normalizePlaceholders(e.content!, characterName)
    )
    .join('\n\n');
  return {
    name: normalizePlaceholders(book.name || `${characterName} 的世界书`, characterName).slice(0, 60),
    content: rendered.slice(0, 10_000),
  };
}

/** 归一化多开场白：主开场白 + 去重后的 alternate_greetings。 */
function buildGreetings(data: StEnvelope, characterName: string): { greeting: string; alternateGreetings: string[] } {
  const greeting = normalizePlaceholders(data.first_mes ?? '', characterName);
  const alternates = (data.alternate_greetings ?? [])
    .map((g) => (typeof g === 'string' ? normalizePlaceholders(g, characterName).trim() : ''))
    .filter((g, i, arr) => g && g !== greeting && arr.indexOf(g) === i)
    .slice(0, 20);
  return { greeting, alternateGreetings: alternates };
}

// ============================================================
// 预填草稿（不落库）：UI 把解析结果填入「新建角色 / 新建 Lorebook」表单，
// 由用户确认后手动保存
// ============================================================

export interface ParsedSillyTavernCard {
  /** v2 / v3 */
  version: string;
  /** 预填到新建角色表单的数据（含头像、人设 prompt、开场白） */
  character: NpcCharacter;
  /** 卡内嵌的 Lorebook（若有），预填到新建 Lorebook 表单 */
  worldBook: { name: string; content: string } | null;
}

/** 解析 PNG 角色卡为表单草稿，不写入数据库（PNG 图片本身作为头像） */
export async function parseSillyTavernCardFile(file: File): Promise<ParsedSillyTavernCard> {
  const buffer = await file.arrayBuffer();
  const parsed = parsePngChara(buffer);
  if (!parsed) throw new Error('未找到角色卡数据（ccv3 / chara）');

  const { key, data } = parsed;
  const name = data.name?.trim() || '未命名角色';
  const { greeting, alternateGreetings } = buildGreetings(data, name);

  const character: NpcCharacter = {
    name,
    prompt: buildPromptFromStructured(data, name),
    greeting,
    alternateGreetings,
    avatarColorOrdinal: Math.floor(Math.random() * 6),
    avatarDataUrl: resolveAvatar(data, pngToDataUrl(buffer)),
    enabledToolNames: [],
    isBuiltIn: false,
    createdAt: Date.now(),
  };

  const lorebook = renderLorebook(data.character_book, name);
  const worldBook = lorebook ? { name: lorebook.name, content: lorebook.content } : null;

  return { version: key === 'ccv3' ? 'v3' : 'v2', character, worldBook };
}
