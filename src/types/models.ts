// ============================================================
// 领域模型 — 与 MyAgent-Android 的 Room 实体一一对应
// ============================================================

export type SessionMode = 'STANDARD' | 'NPC' | 'GROUP';
export type ParticipantKind = 'PLAYER' | 'NPC';
export type TurnOrderMode = 'PRESET' | 'RANDOM';
export type Role = 'system' | 'user' | 'assistant' | 'tool';
export type ThemeModeId = 'system' | 'light' | 'dark';
export type ReasoningEffort = 'auto' | 'off' | 'low' | 'medium' | 'xhigh';
/** 界面语言：null = 跟随浏览器语言 */
export type AppLanguage = 'zh-CN' | 'zh-TW' | 'en' | null;

/**
 * 工具结果展示引用（file_display 等内置展示工具的回看锚点）。
 * 持久化在 ChatMessage.displayRef，供对话流里的「查看」按钮随时重开弹窗。
 */
export interface DisplayFileRef {
  /** 工作区相对路径（与 file_read / file_write 同一沙箱工作区） */
  path: string;
  /** 展示方式：text（按扩展名智能渲染）/ image / html */
  kind: 'text' | 'image' | 'html';
  /** 展示标题（默认取文件名） */
  title?: string;
  /** 提示附带的展示结果文本（工具结果的持久化，回看时无需重读文件） */
  cachedContent?: string;
}

export interface AppSettings {
  id: number;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  defaultProviderId: number | null;
  themeMode: ThemeModeId;
  /** 界面语言；null = 跟随浏览器语言 */
  language: AppLanguage;
  temperature: number;
  topP: number;
  maxTokens: number;
  topK: number;
  frequencyPenalty: number;
  presencePenalty: number;
  repetitionPenalty: number;
  reasoningEffort: ReasoningEffort;
  seed: number;
  stop: string;
  isStreaming: boolean;
  isThinkingModeEnabled: boolean;
  isToolCallsEnabled: boolean;
  statsResetTime: number | null;
}

export interface FieldMapping {
  sourceField: string;
  sourceValue?: string;
  targetField: string;
  targetValue?: string;
}

export interface ApiProvider {
  id?: number;
  name: string;
  baseUrl: string;
  apiKey: string;
  isEnabled: boolean;
  cachedModelsCsv: string;
  fieldMappingsJson: string;
  createdAt: number;
}

export interface NpcCharacter {
  id?: number;
  name: string;
  prompt: string;
  greeting: string;
  /** 额外开场白（创建对话时随机选用一个，含 greeting） */
  alternateGreetings?: string[];
  avatarColorOrdinal: number;
  avatarDataUrl?: string | null;
  enabledToolNames: string[]; // CSV in DB; array in memory
  isBuiltIn: boolean;
  createdAt: number;
}

export interface ChatSession {
  id?: number;
  title: string;
  mode: SessionMode;
  associatedId: number | null; // NPC id（NPC 模式）
  worldBookId: number | null;
  userPersonaNpcId: number | null;
  enableGreeting?: boolean;
  turnOrderMode: TurnOrderMode;
  turnQueueJson: string;
  /** 各循环的完整初始顺序历史（JSON 二维数组），用于群聊发言队列面板展示完整历史 */
  turnQueueHistoryJson: string;
  loopIndex: number;
  lastMessage: string;
  /** 置顶标记：1 = 置顶（侧边栏会话列表置顶区），0 = 未置顶。默认 0（false） */
  pinned: number;
  updatedAt: number;
  createdAt: number;
}

export interface ChatParticipant {
  sessionId: number;
  participantId: number;
  kind: ParticipantKind;
  npcId: number | null;
  displayName: string;
  seatOrder: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  argumentsJson: string;
  contentOffset: number;
}

export interface ChatAttachmentInfo {
  // 保存元信息，dataUrl 单独存字段（避免所有消息都过大）
  mimeType: string;
  displayName: string;
  sizeBytes: number;
}

export interface ChatMessage {
  id?: number;
  sessionId: number;
  role: Role;
  speakerParticipantId: number | null;
  speakerName: string | null;
  content: string;
  /** 持久化用 JSON 字符串数组 */
  toolCallsJson: string;
  toolCallId: string | null;
  thinkingContent: string | null;
  /** 群聊：该消息所属的循环序号（0 起）。用于对话与发言队列联动滚动 / 点击定位 */
  loopIndex: number | null;
  timestamp: number;
  latencyMs: number | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  tokensPerSec: number | null;
  modelUsed: string | null;
  /** dataUrl 或 URL 的附件列表 */
  attachments: string[];
  attachmentInfos: ChatAttachmentInfo[];
  /**
   * 展示类工具（file_display）的结果锚点：JSON 字符串化的 DisplayFileRef。
   * 工具结果消息携带它，UI 据此渲染「查看」按钮并提供弹窗回看。
   */
  displayRef: string | null;
  rawRequestBody: string | null;
  rawResponseBody: string | null;
}

export interface CareerStatsTotal {
  id: number;
  inputTokens: number;
  outputTokens: number;
  totalRounds: number;
}

export interface CareerNpcStat {
  npcId: number;
  npcName: string;
  rounds: number;
}

/** 成就解锁记录 */
export interface AchievementUnlock {
  id?: number;
  achievementId: string;
  unlockedAt: number;
}

export interface McpTool {
  id?: number;
  name: string;
  jsonContent: string; // 标准 OpenAI tool JSON
  executionJson: string | null; // 生成式技能的声明式实现
  isBuiltIn: boolean;
  /** 来源：builtin 内置（读写受保护）/ custom 自定义（create_skill 创建）/ imported 导入（玩法导入） */
  origin?: 'builtin' | 'custom' | 'imported';
  createdAt: number;
  displayOrder: number;
}

export type ScheduledTaskStatus = 'pending' | 'completed' | 'cancelled' | 'failed';

export interface ScheduledTask {
  id: string;
  sessionId: number;
  sourceTurnMessageId: number | null;
  label: string;
  triggerAtMillis: number;
  messageContent: string;
  showNotification: boolean;
  characterNameSnapshot: string;
  status: ScheduledTaskStatus;
  resultMessage: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface WorldBook {
  id?: number;
  name: string;
  content: string;
  imageUri: string | null;
  createdAt: number;
}

// ---------- 网络层模型 ----------

export interface NetworkContentPart {
  type: 'text' | 'image_url' | 'video_url';
  text?: string;
  image_url?: { url: string };
  video_url?: { url: string };
}

export interface NetworkMessage {
  role: Role;
  content: string | NetworkContentPart[] | null;
  tool_calls?: NetworkToolCall[];
  tool_call_id?: string;
}

export interface NetworkToolFunction {
  name: string;
  arguments: string;
}

export interface NetworkToolCall {
  id: string;
  type: 'function';
  function: NetworkToolFunction;
}

export interface ChatCompletionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: NetworkMessage[];
  tools?: ChatCompletionTool[];
  tool_choice?: string;
  temperature: number;
  top_p?: number;
  max_tokens?: number;
  stream: boolean;
  stream_options?: { include_usage: boolean };
  enable_thinking?: boolean;
  reasoning_effort?: string;
  chat_template_kwargs?: { enable_thinking: boolean; preserve_thinking: boolean };
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
}

// ---------- 流式分块 ----------

export type ChatStreamChunk =
  | { type: 'raw'; line: string }
  | { type: 'content'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; id: string; name: string; argJson: string }
  | { type: 'usage'; prompt: number; completion: number; total: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface ToolConfirmationRequest {
  sessionId: number;
  toolName: string;
  title: string;
  message: string;
  argsJson: string;
}

export interface GeneratedSkillExecution {
  type: 'template' | 'http_get' | 'javascript' | 'file_read' | 'file_write' | 'shell' | 'device_action';
  // template
  template?: string;
  // http_get
  url?: string;
  // javascript
  code?: string;
  // file_read / file_write
  path?: string;
  content?: string;
  json_content?: unknown;
  append?: boolean;
  append_newline?: boolean;
  // shell
  script?: string;
  // device_action
  action?: 'flashlight' | 'vibrate' | 'notification' | 'sequence';
  state?: 'on' | 'off' | 'blink';
  flashes?: number;
  on_ms?: number;
  off_ms?: number;
  duration_ms?: number;
  title?: string;
  message?: string;
  sequence?: GeneratedSkillExecution[];
  [k: string]: unknown;
}

export interface DiceResult {
  expression: string;
  rolls: number[];
  modifier: number;
  total: number;
  critical?: 'success' | 'failure';
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: number;
}

export interface SearchResultItem {
  title: string;
  snippet: string;
  url: string;
}