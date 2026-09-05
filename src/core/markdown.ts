import katex from 'katex';
import 'katex/dist/katex.min.css';
import { marked } from 'marked';

// ============================================================
// Markdown 渲染（marked + katex + 代码高亮）
// ============================================================

marked.setOptions({
  gfm: true,
  breaks: true,
});

const CODE_KEYWORDS = new Set([
  'function','const','let','var','return','if','else','for','while','do','switch','case','break',
  'continue','new','class','extends','super','import','export','from','default','async','await',
  'try','catch','finally','throw','typeof','instanceof','in','of','this','null','undefined','true',
  'false','void','delete','yield','static','get','set','public','private','protected','readonly',
  'interface','type','enum','namespace','declare','abstract','implements','package','def','lambda',
  'then','when','where','data','typeclass','module','pub','fn','use','let','mut','impl','struct',
  'enum','trait','fn','match','println','int','float','double','char','boolean','String','int64',
  'print','range','if','elif','else','for','while','in','not','and','or','None','True','False',
]);

/** 单块代码语法高亮（轻量级，与 App highlightCode 一致） */
export function highlightCode(code: string, lang?: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const tokenRe = /(\/\/[^\n]*)|("[^"\n]*"|'[^'\n]*')|(\b\d+(?:\.\d+)?\b)|([A-Z]\w*)|(\b[A-Za-z_]\w*\b)|(\s+)/g;

  let out = '';
  let last = 0;
  const text = code;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(text)) !== null) {
    const [full, comment, str, num, type, kw] = m;
    if (m.index > last) out += esc(text.slice(last, m.index));
    if (comment) out += `<span class="tok tok-comment">${esc(comment)}</span>`;
    else if (str) out += `<span class="tok tok-str">${esc(str)}</span>`;
    else if (num) out += `<span class="tok tok-num">${esc(num)}</span>`;
    else if (type) out += `<span class="tok tok-type">${esc(type)}</span>`;
    else if (kw && CODE_KEYWORDS.has(kw)) out += `<span class="tok tok-kw">${esc(kw)}</span>`;
    else if (kw) out += esc(kw);
    else out += esc(full);
    last = m.index + full.length;
  }
  if (last < text.length) out += esc(text.slice(last));
  void lang;
  return out;
}

/** 块级数学渲染（$$...$$ 或 \[...\]） */
function renderBlockMath(matches: Array<{ raw: string; content: string; index: number }>, html: string): string {
  let result = html;
  for (const m of matches) {
    const katexHtml = renderKatexInline(m.content, true);
    result = result.replace(m.raw, katexHtml);
  }
  return result;
}

function renderKatexInline(content: string, displayMode: boolean): string {
  try {
    return katex.renderToString(content, {
      displayMode,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    return `<span class="math-fallback mono">$${content}$</span>`;
  }
}

/** 数学公式：内联 $...$ / \(...\) 与块级 $$...$$ / \[...\] */
export function renderMath(content: string, displayMode: boolean): string {
  try {
    return katex.renderToString(content, {
      displayMode,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    return content;
  }
}

interface BlockMathMatch {
  raw: string;
  content: string;
  index: number;
}

/** 解析块级数学公式（$$ 或 \[ \]） */
export function extractBlockMath(source: string): { text: string; matches: BlockMathMatch[] } {
  const matches: BlockMathMatch[] = [];
  // $$...$$ (支持多行)
  const re1 = /\$\$([\s\S]+?)\$\$/g;
  let m: RegExpExecArray | null;
  const cleaned = source
    .replace(re1, (raw, content, index) => {
      matches.push({ raw, content: content.trim(), index });
      return `￼BLOCKMATH${matches.length - 1}￼`;
    })
    .replace(/\\\[([\s\S]+?)\\\]/g, (raw, content, index) => {
      matches.push({ raw, content: content.trim(), index });
      return `￼BLOCKMATH${matches.length - 1}￼`;
    });
  return { text: cleaned, matches };
}

/** 内联数学 $...$ */
export function renderInlineMath(html: string): string {
  // 先保护代码块里的 $（marked 已转义为 &dollar;，避免冲突）
  const inlineRe = /(?<!\\)\$(?!\$)(.+?)(?<!\\)\$/g;
  let attempts = 0;
  let result = html;
  while (inlineRe.test(result) && attempts < 20) {
    attempts++;
    result = result.replace(
      inlineRe,
      (raw, content: string) => {
        try {
          const rendered = katex.renderToString(content.trim(), { throwOnError: false, displayMode: false });
          return rendered;
        } catch {
          return raw;
        }
      }
    );
  }
  return result;
}

interface MarkdownSegment {
  kind: 'text' | 'blockMath' | 'code';
  html: string;
  mathContent?: string;
  displayMode?: boolean;
}

/** 主流程：源文本 → 分段（含数学与代码高亮） */
export function renderMarkdown(source: string, opts?: { mathEnabled?: boolean }): string {
  const mathEnabled = opts?.mathEnabled ?? true;
  // 1. 提取块级数学
  const { text, matches } = extractBlockMath(source);

  // 2. 保护代码块（防止 marked 解析数学占位符）
  const codeBlocks: string[] = [];
  const withoutCode = text.replace(/```[\s\S]*?```/g, (raw) => {
    codeBlocks.push(raw);
    return `￼CODE${codeBlocks.length - 1}￼`;
  });

  // 3. marked 渲染
  let html = marked.parse(withoutCode, { async: false }) as string;

  // 4. 还原代码块并高亮
  html = html.replace(/￼CODE(\d+)￼/g, (_, i) => {
    const raw = codeBlocks[Number(i)];
    const langMatch = raw.match(/^```(\w*)\s*\n([\s\S]*?)\n*```$/);
    const lang = langMatch?.[1] ?? '';
    const code = langMatch?.[2] ?? raw.replace(/^```\w*\s*\n?/, '').replace(/```$/, '');
    return `<pre class="code-block"><code class="lang-${lang}">${highlightCode(code, lang)}</code></pre>`;
  });

  // 5. 还原块级数学
  html = html.replace(/￼BLOCKMATH(\d+)￼/g, (_, i) => {
    const m = matches[Number(i)];
    if (mathEnabled && m) return `<div class="math-block">${renderMath(m.content, true)}</div>`;
    return `<div class="math-block mono math-fallback">$$${m?.content ?? ''}$$</div>`;
  });

  // 6. 行内数学（保留 <code> 内部）
  if (mathEnabled) {
    const htmlNoCode = html.replace(/<code[^>]*>[\s\S]*?<\/code>/g, (raw) => {
      const token = `￼CODEHTML${codeBlocks.length}￼`;
      codeBlocks.push(raw);
      return token;
    });
    let processed = renderInlineMath(htmlNoCode);
    processed = processed.replace(/￼CODEHTML(\d+)￼/g, (_, i) => codeBlocks[i]);
    html = processed;
  }

  return html;
}

/** @mention 高亮（发言者名字最长优先） */
export function highlightMentions(html: string, names: string[]): string {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  let result = html;
  for (const name of sorted) {
    // 仅在非 code 区域高亮（简化处理：直接替换 @名字）
    const re = new RegExp(`(@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=\\s|[，。！？,.!?]|$)`, 'g');
    result = result.replace(re, '<span class="mention">$1</span>');
  }
  return result;
}

export const unescapeHtml = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");