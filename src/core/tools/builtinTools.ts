import type { DiceResult, SearchResultItem } from '../../types/models';

// ============================================================
// roll_dice — 与 App 的 DiceRoller 一致
// ============================================================

const DICE_RE = /^(\d*)d(\d+)([+-]\d+)?$/;

export function rollDice(expression: string): string {
  const expr = expression.trim() || '1d20';
  const m = expr.match(DICE_RE);
  if (!m) return `ERROR: 无效的骰子表达式 "${expression}"，示例: d20, 2d6, 3d10+2`;

  const count = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10);
  const modifier = m[3] ? parseInt(m[3], 10) : 0;

  if (count < 1 || count > 100) return 'ERROR: 骰子数量需在 1-100 之间';
  if (sides < 2 || sides > 10000) return 'ERROR: 骰子面数需在 2-10000 之间';
  if (Math.abs(modifier) > 1000000) return 'ERROR: 修正值过大';

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(1 + Math.floor(Math.random() * sides));
  }
  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + modifier;

  let critical = '';
  if (count === 1 && sides === 20) {
    if (rolls[0] === 20) critical = ' 大成功！';
    else if (rolls[0] === 1) critical = ' 大失败！';
  }

  const parts = [rolls.join(', ')];
  if (modifier !== 0) parts.push(`${modifier > 0 ? '+' : ''}${modifier}`);
  return `掷骰 ${expr}: [${parts.join('] ')}] = ${total}${critical}`;
}

// ============================================================
// web_search — Bing（国内友好），无 API Key
// ============================================================

const UA_ROTATION = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
];

export async function webSearch(q: string, maxResults = 5): Promise<string> {
  const clamp = Math.max(1, Math.min(10, maxResults || 5));
  const attempts: Array<() => Promise<SearchResultItem[]>> = [
    () => searchViaJina(q),
    () => searchBing('https://cn.bing.com/search?q=' + encodeURIComponent(q)),
    () => searchBing('https://www.bing.com/search?q=' + encodeURIComponent(q)),
  ];

  let lastError = '';
  for (const attempt of attempts) {
    try {
      const items = await attempt();
      if (items.length > 0) {
        return formatResults(q, items.slice(0, clamp));
      }
    } catch (e) {
      lastError = (e as Error).message || String(e);
    }
  }
  return `ERROR: 搜索失败 (${lastError || '无结果'})`;
}

async function searchViaJina(q: string): Promise<SearchResultItem[]> {
  const resp = await fetch(`https://r.jina.ai/http://cn.bing.com/search?q=${encodeURIComponent(q)}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`jina HTTP ${resp.status}`);
  const text = await resp.text();
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const items: SearchResultItem[] = [];
  for (let i = 0; i < lines.length - 2; i++) {
    const line = lines[i];
    if (/^\d+\.\s/.test(line) && (line.length > 12)) {
      const title = line.replace(/^\d+\.\s/, '');
      // 下一行是 URL
      const urlLine = lines[i + 1];
      const urlMatch = urlLine.match(/https?:\/\/[^\s]+/);
      const snippet = lines[i + 2] && !/^https?:/.test(lines[i + 2]) ? lines[i + 2] : '';
      items.push({
        title,
        snippet: sanitizeSnippet(snippet),
        url: urlMatch ? urlMatch[0].replace(/[.,;:]+$/, '') : '',
      });
      i += 2;
    }
  }
  return items;
}

async function searchBing(url: string): Promise<SearchResultItem[]> {
  const ua = UA_ROTATION[Math.floor(Math.random() * UA_ROTATION.length)];
  const resp = await fetch(url, {
    headers: { 'User-Agent': ua, Accept: 'text/html' },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`bing HTTP ${resp.status}`);
  const html = await resp.text();
  if (html.length > 200_000) throw new Error('页面过大');
  const items: SearchResultItem[] = [];
  const liRe = /<li class="b_algo"[\s\S]*?<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(html)) && items.length < 10) {
    const block = m[0];
    const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const url = decodeHtml(titleMatch[1]);
    const title = stripHtml(titleMatch[2]);
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';
    items.push({ title: title.trim(), snippet: sanitizeSnippet(snippet), url });
  }
  return items;
}

function formatResults(q: string, items: SearchResultItem[]): string {
  const lines = [`查询: ${q}`, '搜索结果:'];
  items.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.title} — ${it.snippet} <${it.url}>`);
  });
  return lines.join('\n');
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function decodeHtml(s: string): string {
  return stripHtml(s);
}

function sanitizeSnippet(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 250);
}

export function rollDiceStructured(expression: string): DiceResult | null {
  const m = expression.trim().match(DICE_RE);
  if (!m) return null;
  const count = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10);
  const modifier = m[3] ? parseInt(m[3], 10) : 0;
  if (count < 1 || count > 100 || sides < 2 || sides > 10000) return null;
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + modifier;
  let critical: DiceResult['critical'];
  if (count === 1 && sides === 20) {
    critical = rolls[0] === 20 ? 'success' : rolls[0] === 1 ? 'failure' : undefined;
  }
  return { expression: expression.trim(), rolls, modifier, total, critical };
}