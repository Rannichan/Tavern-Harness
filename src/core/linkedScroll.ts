// ============================================================
// 群聊「对话 ⇄ 发言队列」双向联动滚动 + 点击定位（平滑版）
// 两个滚动容器（chat-scroll / turn-queue-body）通过本模块互相驱动：
// - 滚动对话 → 队列平滑滚动到对应循环
// - 滚动队列 → 对话平滑滚动到对应循环
// - 点击队列中的某次发言 → 对话平滑滚动到该循环中对应发言者的消息
// 依赖消息行上的 data-loop（0 起始循环号）与 data-speaker；队列循环组 data-loop 同语义。
//
// 平滑实现要点：
// - 程序化滚动统一走 rAF 线性插值（lerp），不依赖 CSS scroll-behavior，
//   避免「浏览器动画反复重启」造成的跳变/闪动
// - 以「时间窗」抑制自身滚动产生的事件，防止双向驱动死循环
// ============================================================

let chatEl: HTMLElement | null = null;
let queueEl: HTMLElement | null = null;

// 程序化写入产生的滚动事件在窗口内被忽略（防死循环）
let chatSuppressUntil = 0;
let queueSuppressUntil = 0;

export function registerChatEl(el: HTMLElement | null): void {
  chatEl = el;
  chatSuppressUntil = 0;
}
export function registerQueueEl(el: HTMLElement | null): void {
  queueEl = el;
  queueSuppressUntil = 0;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampScroll(el: HTMLElement, top: number): number {
  return Math.max(0, Math.min(top, Math.max(0, el.scrollHeight - el.clientHeight)));
}

/** 行内容在容器内的绝对位置（不受 scrollTop / 内边距影响） */
function contentOffsetOf(container: HTMLElement, row: HTMLElement): number {
  const cr = container.getBoundingClientRect();
  return row.getBoundingClientRect().top - cr.top + container.scrollTop;
}

interface ScanRow {
  el: HTMLElement;
  off: number;
  h: number;
  loop: number;
}

/** 扫描容器内全部带 data-loop 的行（DOM 顺序） */
function scanRows(container: HTMLElement): ScanRow[] {
  const rows: ScanRow[] = [];
  const cr = container.getBoundingClientRect();
  container.querySelectorAll<HTMLElement>('[data-loop]').forEach((r) => {
    const rr = r.getBoundingClientRect();
    rows.push({ el: r, off: rr.top - cr.top + container.scrollTop, h: rr.height, loop: Number(r.dataset.loop) });
  });
  return rows;
}

function rowsOf(container: HTMLElement, loop: number): ScanRow[] {
  return scanRows(container).filter((r) => r.loop === loop);
}

/** 某循环的内容跨度（首行顶 → 末行底），用于把滚动位置映射为 0..1 进度 */
function spanOf(container: HTMLElement, loop: number): { firstTop: number; height: number } | null {
  const rows = rowsOf(container, loop);
  if (rows.length === 0) return null;
  const firstTop = rows[0].off;
  const lastBottom = rows[rows.length - 1].off + rows[rows.length - 1].h;
  return { firstTop, height: Math.max(1, lastBottom - firstTop) };
}

/** 光标（容器内绝对位置）所在循环 + 该循环内进度（0=顶，1=底） */
function cursorLoopOf(container: HTMLElement, cursor: number): { loop: number; progress: number } {
  let loop = 0;
  for (const r of scanRows(container)) {
    if (cursor < r.off) break;
    loop = r.loop;
    if (cursor <= r.off + r.h) break;
  }
  const span = spanOf(container, loop);
  const progress = span ? clamp01((cursor - span.firstTop) / span.height) : 0;
  return { loop, progress };
}

/** 把某循环滚动到窗口内指定进度：循环内 progress 处的内容对齐到视口中心。
 * 双向（对话→队列 / 队列→对话）用同一映射，保证来回一致；循环短于视口时
 * 目标可能为负 → 钳制到 0..max，不会反向跳顶。 */
function targetForLoop(container: HTMLElement, loop: number, progress: number): number {
  const span = spanOf(container, loop);
  if (!span) return container.scrollTop;
  const cursor = span.firstTop + progress * span.height;
  return clampScroll(container, cursor - container.clientHeight / 2);
}

// ---------- 平滑滚动核心 ----------
// 两种动画机制：
// 1) chaseScroll：连续跟随（拖动/原生平滑滚动产生的连续事件）。
//    用指数平滑每帧逼近目标，事件持续到来时自然衔接，不会因为“每次重启动画”而脉冲抖动。
// 2) animateTo：单次导航（点击队列发言定位、新循环加入）。时长缓动 + 干净收尾。

const clampSet = new Set<HTMLElement>(); // 正在持续跟随的容器
const chaseWanted = new Map<HTMLElement, number>();
let chaseRaf = 0;

function writeScrollTop(el: HTMLElement, v: number): void {
  const clamped = clampScroll(el, v);
  if (Math.abs(clamped - el.scrollTop) < 0.5) return;
  // 标记「程序化写入」时间窗：本次写入触发的滚动事件要忽略，防反馈死循环
  if (el === chatEl) chatSuppressUntil = performance.now() + 90;
  else if (el === queueEl) queueSuppressUntil = performance.now() + 90;
  el.scrollTop = clamped;
}

function chaseTick(now: number): void {
  chaseRaf = 0;
  for (const el of clampSet) {
    const wanted = chaseWanted.get(el) ?? el.scrollTop;
    const diff = wanted - el.scrollTop;
    if (Math.abs(diff) < 0.5) {
      clampSet.delete(el);
      chaseWanted.delete(el);
      continue;
    }
    // 指数趋近：距目标越近越慢，避免过冲；步长上限防止太快导致“跳”
    const step = Math.min(Math.abs(diff), Math.max(8, Math.abs(diff) * 0.16));
    writeScrollTop(el, el.scrollTop + Math.sign(diff) * step);
  }
  if (clampSet.size > 0) chaseRaf = requestAnimationFrame(chaseTick);
  void now;
}

/** 连续跟随：目标可被后续调用持续更新，内部每帧指数趋近 */
function chaseScroll(el: HTMLElement, target: number): void {
  chaseWanted.set(el, clampScroll(el, target));
  if (!clampSet.has(el)) {
    clampSet.add(el);
    if (!chaseRaf) chaseRaf = requestAnimationFrame(chaseTick);
  }
}

interface Anim {
  el: HTMLElement;
  from: number;
  to: number;
  start: number;
  dur: number;
}
let anim: Anim | null = null;
let rafId = 0;

function tick(now: number): void {
  rafId = 0;
  if (!anim) return;
  const t = Math.min(1, (now - anim.start) / anim.dur);
  const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
  writeScrollTop(anim.el, anim.from + (anim.to - anim.from) * eased);
  if (t < 1) rafId = requestAnimationFrame(tick);
  else anim = null;
}

function animateTo(el: HTMLElement, target: number, dur = 240): void {
  const to = clampScroll(el, target);
  const from = el.scrollTop;
  if (Math.abs(to - from) < 1) return;
  // 与持续跟随互斥：单次导航时停掉 chase
  clampSet.delete(el);
  chaseWanted.delete(el);
  anim = { el, from, to, start: performance.now(), dur };
  if (!rafId) rafId = requestAnimationFrame(tick);
}

function isChatSuppressed(): boolean {
  return performance.now() < chatSuppressUntil;
}
function isQueueSuppressed(): boolean {
  return performance.now() < queueSuppressUntil;
}

// ---------- 对外接口 ----------

/** 对话区滚动 → 联动队列（连续跟随，平滑） */
export function onChatScroll(): void {
  if (!chatEl || !queueEl) return;
  if (isChatSuppressed()) return;
  const cursor = chatEl.scrollTop + chatEl.clientHeight / 2;
  const { loop, progress } = cursorLoopOf(chatEl, cursor);
  chaseScroll(queueEl, targetForLoop(queueEl, loop, progress));
}

/** 队列滚动 → 联动对话（连续跟随，平滑） */
export function onQueueScroll(): void {
  if (!chatEl || !queueEl) return;
  if (isQueueSuppressed()) return;
  const cursor = queueEl.scrollTop + queueEl.clientHeight / 2;
  const { loop, progress } = cursorLoopOf(queueEl, cursor);
  chaseScroll(chatEl, targetForLoop(chatEl, loop, progress));
}

/**
 * 点击队列中的某次发言 → 对话平滑滚动到该循环中对应发言者的消息。
 * speakerKey：玩家消息为 'player'，NPC 为 participantId 字符串；null 时滚到该循环第一条。
 */
export function scrollChatTo(loop: number, speakerKey: string | null): void {
  if (!chatEl) return;
  const rows = rowsOf(chatEl, loop);
  const target = rows.find((r) => r.el.dataset.speaker === speakerKey) ?? rows[0] ?? null;
  if (!target) return;
  animateTo(chatEl, contentOffsetOf(chatEl, target.el) - chatEl.clientHeight * 0.2, 320);
}

/** 队列面板：新循环加入时平滑滚动到当前循环（底部对齐，整组可见） */
export function scrollQueueToLoop(loop: number): void {
  if (!queueEl) return;
  animateTo(queueEl, targetForLoop(queueEl, loop, 1), 280);
}