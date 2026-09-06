import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderMarkdown, highlightMentions } from '../core/markdown';

// ============================================================
// 通用弹窗容器（Portal 到 body，避开祖先 backdrop-filter 产生的
// 包含块，保证全页面居中、遮罩覆盖全屏、点击可用）
// ============================================================

export function Modal({
  onClose,
  width,
  children,
}: {
  onClose: () => void;
  width?: string | number;
  children: React.ReactNode;
}) {
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal-root" onClick={(e) => e.stopPropagation()}>
        <div className="modal card fade-up" style={width != null ? { width } : undefined}>
          {children}
        </div>
      </div>
    </>,
    document.body
  );
}

// ============================================================
// Markdown 渲染组件（支持数学公式 + 代码高亮）
// ============================================================

interface MdProps {
  text: string;
  mathEnabled?: boolean;
  mentionNames?: string[];
}

export function Markdown({ text, mathEnabled = true, mentionNames = [] }: MdProps) {
  const html = useMemo(() => {
    let h = renderMarkdown(text, { mathEnabled });
    if (mentionNames.length > 0) h = highlightMentions(h, mentionNames);
    return h;
  }, [text, mathEnabled, mentionNames]);

  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ============================================================
// 头像（彩色首字母 / 图片）
// ============================================================

export function Avatar({
  name,
  colorOrdinal,
  imageUrl,
  size = 'sm',
}: {
  name: string;
  colorOrdinal?: number;
  imageUrl?: string | null;
  size?: 'sm' | 'xs' | 'lg';
}) {
  const cls = size === 'lg' ? 'avatar' : size === 'xs' ? 'avatar xs' : 'avatar sm';
  const hue = (colorOrdinal ?? 0) % 6;
  if (imageUrl) {
    return (
      <div className={cls}>
        <img src={imageUrl} alt={name} />
      </div>
    );
  }
  return <div className={`${cls} avatar-hue-${hue}`}>{name.slice(0, 1)}</div>;
}

// ============================================================
// 附件卡片：仅展示文件名（去掉图片/视频缩略图）
// ============================================================

export function AttachCard({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <div className="attach-card">
      <span className="attach-card-icon">📎</span>
      <span className="attach-card-name" title={name}>{name}</span>
      {onRemove && (
        <button className="attach-rm" onClick={onRemove} title="移除附件">
          <Icon name="x" size={11} />
        </button>
      )}
    </div>
  );
}

// ============================================================
// 群聊头像拼贴（方框内嵌套至多 4 位参与角色头像）
// ============================================================

export interface SessionMember {
  name: string;
  colorOrdinal: number;
  imageUrl?: string | null;
}

function GroupCollage({ members, size }: { members: SessionMember[]; size: 'sm' | 'lg' }) {
  // 始终渲染 2×2 四宫格；成员不足 4 位时空余格子留空
  return (
    <div className={`gcollage gcollage-m4 ${size === 'lg' ? 'gcollage-lg' : ''}`}>
      {[0, 1, 2, 3].map((i) => {
        const m = members[i];
        return (
          <div key={i} className="gslot">
            {m ? <Avatar name={m.name} colorOrdinal={m.colorOrdinal} imageUrl={m.imageUrl} size="xs" /> : null}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// 会话头像（模式图标 / 群聊拼贴）
// ============================================================

export function SessionVisual({
  mode,
  npcName,
  hue,
  imageUrl,
  members,
  size = 'sm',
}: {
  mode: string;
  npcName?: string;
  hue?: number;
  imageUrl?: string | null;
  members?: SessionMember[];
  size?: 'sm' | 'lg';
}) {
  if (mode === 'STANDARD') {
    return (
      <div className="svc">
        <span>💬</span>
      </div>
    );
  }
  if (mode === 'NPC') {
    return (
      <div className={`svc svc-single ${size === 'lg' ? 'svc-group-lg' : ''}`}>
        <Avatar name={npcName ?? 'NPC'} colorOrdinal={hue ?? 0} imageUrl={imageUrl} />
      </div>
    );
  }
  // GROUP
  return (
    <div className={`svc svc-group ${size === 'lg' ? 'svc-group-lg' : ''}`}>
      <GroupCollage members={members ?? []} size={size} />
    </div>
  );
}

// ============================================================
// 折叠面板（Thinking / 工具调用卡片共用）
// ============================================================

export function Collapse({
  title,
  icon,
  preview,
  children,
  accent = 'default',
  defaultOpen = false,
  live = false,
}: {
  title: string;
  icon?: string;
  preview?: string;
  children: React.ReactNode;
  accent?: 'think' | 'tool' | 'success' | 'error' | 'default';
  defaultOpen?: boolean;
  live?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      setOverflow(el.scrollHeight > el.clientHeight + 4);
    }
  }, [preview, children]);

  const cls = `collp ${accent !== 'default' ? `collp-${accent}` : ''}`;
  return (
    <div className={cls}>
      <button className="collp-head" onClick={() => setOpen(!open)}>
        {icon && <span className="collp-icon">{icon}</span>}
        <span className="collp-title">{title}</span>
        {live && <span className="collp-live"><span className="spinner" style={{ width: 12, height: 12 }} /></span>}
        <span className="collp-arrow" style={{ transform: open ? 'rotate(180deg)' : undefined }}>▾</span>
      </button>
      {open && (
        <div className="collp-body">
          <div ref={contentRef} className="collp-content">{children}</div>
          {overflow && !preview && <div className="collp-more">（点击展开完整内容）</div>}
        </div>
      )}
      {!open && preview && <div className="collp-preview">{preview.slice(0, 120)}{preview.length > 120 ? '…' : ''}</div>}
    </div>
  );
}

// ============================================================
// 图标（轻量内联 SVG，避免依赖图标库）
// ============================================================

const ICONS: Record<string, React.ReactNode> = {
  send: <path d="M3 11.5 21 3l-8.5 18-2.5-7.5L3 11.5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  refresh: <path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" />,
  settings: <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />,
  users: <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  file: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM14 2v6h6" />,
  chart: <path d="M18 20V10M12 20V4M6 20v-6" />,
  trophy: <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>,
  book: <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>,
  dice: <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M16 8.5h-2.5V11M13.5 8.5l1 1" /><circle cx="8" cy="10" r=".5" fill="currentColor"/><circle cx="12" cy="15" r=".5" fill="currentColor"/><circle cx="16" cy="16" r=".5" fill="currentColor"/></>,
  check: <path d="M20 6 9 17l-5-5" />,
  cancel: <path d="M18 6 6 18M6 6l12 12" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  paperclip: <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48" />,
  share: <><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="m16 6-4-4-4 4M12 2v13" /></>,
  'user-persona': <><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-3.2 4.4-5 8-5s6.5 1.8 8 5" /></>,
  sort: <><path d="M11 5h10M11 9h7M11 13h4" /><path d="m3 17 3 3 3-3M6 20V4" /></>,
  shuffle: <><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
  pencil: <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5l-5 1 1-5Z" /><path d="m15 5 4 4" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
};

export function Icon({ name, size = 15 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {ICONS[name] ?? ICONS.more}
    </svg>
  );
}