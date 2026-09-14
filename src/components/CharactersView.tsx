import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../store/store';
import { db } from '../db/database';
import type { NpcCharacter, WorldBook, McpTool } from '../types/models';
import { Avatar, Icon, Markdown, Modal } from './shared';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { parseSillyTavernCardFile, type ParsedSillyTavernCard } from '../core/sillyTavernImporter';
import { ALL_BUILTIN_TOOL_NAMES } from '../core/toolDefinitions';
import { useT } from '../core/i18n';

// 内置角色「酒馆老板」默认启用所有技能
const ALL_DEFAULT_SKILLS = [...ALL_BUILTIN_TOOL_NAMES];

// ============================================================
// 角色工坊（NPC 管理 / Lorebook / 技能表 / PNG 导入）
// 说明：PNG 导入只解析不落库，打开「新建角色 / 新建Lorebook」表单预填，
//       由用户手动点保存
// ============================================================

export function CharactersView() {
  const npcs = useStore((s) => s.npcs);
  const worldBooks = useStore((s) => s.worldBooks);
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [tab, setTab] = useState<'characters' | 'worldbooks' | 'skills'>('characters');
  const [editing, setEditing] = useState<NpcCharacter | null>(null);
  const [isNew, setIsNew] = useState(false);
  // PNG 解析出的草稿：角色 + 内嵌Lorebook
  const [importDraft, setImportDraft] = useState<ParsedSillyTavernCard | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => fileRef.current?.click();

  const refresh = useStore((s) => s.refreshNpcs);
  const refreshWb = useStore((s) => s.refreshWorldBooks);
  const refreshTools = useStore((s) => s.refreshTools);

  // 每次进入角色工坊都刷新一次，确保聊天中通过技能创建/修改的数据即时可见
  useEffect(() => {
    refresh();
    refreshWb();
    refreshTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImport = async (file: File) => {
    try {
      const draft = await parseSillyTavernCardFile(file);
      setImportDraft(draft);
      if (tab === 'characters' || tab === 'skills') {
        // 角色卡 tab：预填新建角色表单，由用户确认后保存
        setEditing({ ...draft.character, id: undefined });
        setIsNew(true);
        addToast(t('toast.importedChar', { name: draft.character.name, version: draft.version }));
      } else {
        // Lorebook tab：草稿交给 WorldBookList，由 useEffect 打开预填表单（含提示）
        if (!draft.worldBook) {
          addToast(t('toast.noEmbeddedWb', { name: draft.character.name }), 'error');
        }
      }
    } catch (e) {
      addToast(t('toast.importFailed', { msg: (e as Error).message }), 'error');
    }
  };

  return (
    <div className="view-page">
      <div className="view-col">
        <div>
          <h2 className="view-title">{t('workshop.title')}</h2>
          <p className="view-sub">{t('workshop.sub')}</p>
        </div>
        <div className="side-nav" data-hscroll>
          <button className={`nav-chip ${tab === 'characters' ? 'active' : ''}`} onClick={() => setTab('characters')}>
            {t('workshop.tabCharacters')}
          </button>
          <button className={`nav-chip ${tab === 'worldbooks' ? 'active' : ''}`} onClick={() => setTab('worldbooks')}>
            {t('workshop.tabWorldbooks')}
          </button>
          <button className={`nav-chip ${tab === 'skills' ? 'active' : ''}`} onClick={() => setTab('skills')}>
            {t('workshop.tabSkills')}
          </button>
        </div>

        {tab === 'characters' && (
          <CharacterGrid
            npcs={npcs}
            onEdit={(n, isNew) => {
              setEditing(n);
              setIsNew(isNew);
              setImportDraft(null);
            }}
            onImportPng={openFilePicker}
          />
        )}
        {tab === 'worldbooks' && (
          <WorldBookList
            books={worldBooks}
            onChanged={refreshWb}
            onImportPng={openFilePicker}
            importDraft={tab === 'worldbooks' ? importDraft : null}
            onImportDraftConsumed={() => setImportDraft(null)}
          />
        )}
        {tab === 'skills' && <SkillList onChanged={() => {}} />}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImport(f);
          e.target.value = '';
        }}
      />

      {editing && (
        <CharacterEditorModal
          npc={editing}
          isNew={isNew}
          onClose={() => {
            setEditing(null);
            setImportDraft(null);
          }}
          onSaved={() => {
            setImportDraft(null);
            refresh();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------- 角色网格 ----------------

function CharacterGrid({ npcs, onEdit, onImportPng }: { npcs: NpcCharacter[]; onEdit: (n: NpcCharacter, isNew: boolean) => void; onImportPng: () => void }) {
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [pendingDelete, setPendingDelete] = useState<NpcCharacter | null>(null);

  const deleteNpc = async (n: NpcCharacter) => {
    await db.npcs.delete(n.id!);
    useStore.getState().refreshNpcs();
    addToast(t('toast.charDeleted', { name: n.name }));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="group-label" style={{ margin: 0 }}>{t('workshop.charCount', { n: npcs.length })}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={onImportPng} title={t('workshop.pngImportTip')}>
            <Icon name="import" size={13} /> {t('workshop.pngImport')}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              onEdit(
                {
                  name: '',
                  prompt: '',
                  greeting: '',
                  alternateGreetings: [],
                  avatarColorOrdinal: Math.floor(Math.random() * 6),
                  avatarDataUrl: null,
                  enabledToolNames: [],
                  isBuiltIn: false,
                  createdAt: Date.now(),
                },
                true
              )
            }
          >
            <Icon name="plus" size={13} /> {t('workshop.newChar')}
          </button>
        </div>
      </div>
      <div className="char-grid">
        {npcs.map((n) => (
          <div key={n.id} className="char-card fade-up">
            <div className="cname">
              <Avatar name={n.name} colorOrdinal={n.avatarColorOrdinal} imageUrl={n.avatarDataUrl} size="xs" />
              <span className="cname-text">{n.name}</span>
              {n.isBuiltIn && <span className="tag">{t('common.builtin')}</span>}
            </div>
            <div className="cgreet">{n.greeting || t('workshop.noGreeting')}</div>
            {/* 技能区固定渲染（哪怕无技能），保证所有卡片高度一致 */}
            <div className="cskil">
              {n.enabledToolNames.map((s) => (
                <span key={s} className="skill-tag">{s}</span>
              ))}
            </div>
            <div className="cactions">
              <button className="btn btn-sm" onClick={() => onEdit(n, false)}><Icon name="settings" size={12} /> {t('common.edit')}</button>
              <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(n)} disabled={n.isBuiltIn} title={n.isBuiltIn ? t('workshop.protectedTip') : t('common.delete')}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {pendingDelete && (
        <DeleteConfirmDialog
          title={t('workshop.deleteCharTitle')}
          itemName={pendingDelete.name}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteNpc(pendingDelete)}
        />
      )}
    </div>
  );
}

// ---------------- 角色编辑器 ----------------

function CharacterEditorModal({ npc, isNew, onClose, onSaved }: { npc: NpcCharacter; isNew: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [name, setName] = useState(npc.name);
  const [prompt, setPrompt] = useState(npc.prompt);
  // 多个开场白：第一个保存在 greeting，其余保存在 alternateGreetings
  const [greetings, setGreetings] = useState<string[]>([npc.greeting, ...(npc.alternateGreetings ?? [])]);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(npc.avatarDataUrl ?? null);
  // 技能启用状态（内置角色「酒馆老板」默认启用所有内置技能，同时保留已有自定义技能）
  const [enabledToolNames, setEnabledToolNames] = useState<string[]>(() => {
    if (!npc.isBuiltIn) return npc.enabledToolNames;
    const set = new Set(npc.enabledToolNames);
    for (const s of ALL_DEFAULT_SKILLS) set.add(s);
    return [...set];
  });
  const [tools, setTools] = useState<McpTool[]>([]);
  const addToast = useStore((s) => s.addToast);
  const storeTools = useStore((s) => s.tools);

  useEffect(() => {
    setTools(storeTools);
  }, [storeTools]);

  const save = async () => {
    if (!name.trim()) {
      addToast(t('toast.nameRequired'), 'error');
      return;
    }
    // 清理空白/重复项：第一项作为主开场白，其余作为备用
    const cleaned = greetings.map((g) => g.trim()).filter((g, i, arr) => g && arr.indexOf(g) === i);
    const npcData = {
      name: name.trim(),
      prompt,
      greeting: cleaned[0] ?? '',
      alternateGreetings: cleaned.slice(1),
      avatarDataUrl,
      enabledToolNames,
    };
    if (isNew) {
      await db.npcs.add({
        ...npc,
        ...npcData,
      });
      addToast(t('toast.charCreated', { name }));
    } else {
      await db.npcs.update(npc.id!, npcData);
      addToast(t('toast.charUpdated', { name }));
    }
    onSaved();
  };

  const toggleSkill = (skill: string) => {
    setEnabledToolNames((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill]
    );
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal-root" onClick={(e) => e.stopPropagation()}>
        <div className="modal card modal-editor">
          <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 15 }}>{isNew ? t('workshop.newCharTitle') : t('workshop.editCharTitle', { name: npc.name })}</span>
            <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
          </div>
          <div className="modal-body">
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <Avatar name={name || t('chat.speakerChar')} colorOrdinal={npc.avatarColorOrdinal} imageUrl={avatarDataUrl} size="sm" />
              <div style={{ display: 'flex', gap: 8 }}>
                <label className="btn btn-sm" style={{ cursor: 'pointer', position: 'relative' }}>
                  {t('workshop.uploadAvatar')}
                  <input type="file" accept="image/*" hidden onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      const reader = new FileReader();
                      reader.onload = () => setAvatarDataUrl(reader.result as string);
                      reader.readAsDataURL(f);
                    }
                  }} />
                </label>
                {avatarDataUrl && <button className="btn btn-sm btn-ghost" onClick={() => setAvatarDataUrl(null)}>{t('common.clear')}</button>}
              </div>
            </div>
            <div className="field">
              <label>{t('workshop.name')}</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('workshop.charNamePh')} />
            </div>
            <div className="field prompt-field">
              <label>{t('workshop.promptLabel')}</label>
              <textarea className="textarea grow-textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('workshop.promptPh')} />
            </div>
            <div className="field" style={{ flexShrink: 0 }}>
              <label>
                {t('workshop.greetingLabel')}
                <span className="field-hint"> {t('workshop.greetingRandomHint')}</span>
              </label>
              {greetings.map((g, i) => (
                <div key={i} className="greeting-input">
                  <textarea
                    className="textarea grow-textarea greeting-grow"
                    value={g}
                    onChange={(e) => setGreetings((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder={t('workshop.greetingPh')}
                  />
                  <button
                    className="icon-btn greeting-del"
                    title={t('common.delete')}
                    onClick={() => setGreetings((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))}
              <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setGreetings((prev) => [...prev, ''])}>
                <Icon name="plus" size={12} /> {t('workshop.addAltGreeting')}
              </button>
            </div>
            {/* 启用技能：从卡片移入编辑页 */}
            <div className="field" style={{ flexShrink: 0 }}>
              <label>{t('workshop.enableSkills', { a: enabledToolNames.filter((s) => tools.some((t) => t.name === s)).length, b: tools.length })}</label>
              {tools.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('workshop.noSkills')}</div>
              ) : (
                <div className="skill-list-scroll">
                  {tools.map((t) => (
                    <label key={t.name} className={`skill-tag ${enabledToolNames.includes(t.name) ? '' : 'locked'}`} style={{ cursor: 'pointer', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <input type="checkbox" checked={enabledToolNames.includes(t.name)} onChange={() => toggleSkill(t.name)} style={{ accentColor: 'var(--primary)' }} />
                      {t.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Lorebook ----------------

function WorldBookList({ books, onChanged, onImportPng, importDraft, onImportDraftConsumed }: {
  books: WorldBook[];
  onChanged: () => void;
  onImportPng: () => void;
  /** PNG 解析出的角色卡草稿（含内嵌Lorebook） */
  importDraft: ParsedSillyTavernCard | null;
  /** 草稿已被消费（保存/取消）后通知父组件清空 */
  onImportDraftConsumed: () => void;
}) {
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [editing, setEditing] = useState<WorldBook | { name: string; content: string; imageUri: null; createdAt: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WorldBook | null>(null);

  // PNG 导入产生草稿后：预填「新建Lorebook」表单（不落库，由用户手动保存）
  useEffect(() => {
    if (!importDraft) return;
    if (importDraft.worldBook) {
      setEditing({ ...importDraft.worldBook, imageUri: null, createdAt: Date.now() });
      addToast(t('toast.wbDraftImported', { name: importDraft.worldBook.name }));
    }
  }, [importDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeEditor = () => {
    setEditing(null);
    onImportDraftConsumed();
  };

  const saveWb = async (name: string, content: string) => {
    if (!name.trim() || !content.trim()) {
      addToast(t('toast.wbNameContentRequired'), 'error');
      return;
    }
    if (editing && 'id' in editing && editing.id != null) {
      await db.worldBooks.update(editing.id, { name: name.trim(), content });
      addToast(t('toast.wbUpdated'));
    } else {
      await db.worldBooks.add({ name: name.trim(), content, imageUri: null, createdAt: Date.now() });
      addToast(t('toast.wbCreated'));
    }
    setEditing(null);
    onChanged();
    onImportDraftConsumed();
  };

  const deleteWb = async (b: WorldBook) => {
    await db.worldBooks.delete(b.id!);
    addToast(t('toast.wbDeleted'));
    onChanged();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="group-label" style={{ margin: 0 }}>{t('workshop.wbCount', { n: books.length })}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={onImportPng} title={t('workshop.pngImportWbTip')}>
            <Icon name="import" size={13} /> {t('workshop.pngImport')}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({ name: '', content: '', imageUri: null, createdAt: Date.now() })}>
            <Icon name="plus" size={13} /> {t('workshop.newWb')}
          </button>
        </div>
      </div>
      {books.length === 0 && (
        <div className="empty-state">
          <div className="big">📖</div>
          {t('workshop.wbEmpty')}
        </div>
      )}
      <div className="char-grid">
        {books.map((b) => (
          <div key={b.id} className="char-card wb-card fade-up">
            <div className="cname">
              <span style={{ fontSize: 16 }}>📖</span>
              <span className="cname-text">{b.name}</span>
            </div>
            <div className="wcontent">{b.content}</div>
            <div className="cmeta">{t('workshop.wbChars', { n: b.content.length })}</div>
            <div className="cactions">
              <button className="btn btn-sm" onClick={() => setEditing(b)}><Icon name="settings" size={12} /> {t('workshop.browseEdit')}</button>
              <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(b)}><Icon name="trash" size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      {pendingDelete && (
        <DeleteConfirmDialog
          title={t('workshop.deleteWbTitle')}
          itemName={pendingDelete.name}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteWb(pendingDelete)}
        />
      )}

      {editing && (
        <div className="overlay" onClick={closeEditor}>
          <div className="modal-root" onClick={(e) => e.stopPropagation()}>
            <div className="modal card modal-editor">
              <div className="modal-head">
                <span style={{ fontWeight: 800, fontSize: 15 }}>{'id' in editing && editing.id != null ? t('workshop.editWbTitle') : t('workshop.newWbTitle')}</span>
                <button className="icon-btn" onClick={closeEditor}><Icon name="x" /></button>
              </div>
              <WorldBookForm initial={editing} onSave={saveWb} onCancel={closeEditor} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorldBookForm({ initial, onSave, onCancel }: { initial: WorldBook | { name: string; content: string; imageUri: null; createdAt: number }; onSave: (n: string, c: string) => void; onCancel: () => void }) {
  const t = useT();
  const [name, setName] = useState(initial.name);
  const [content, setContent] = useState(initial.content);
  const [renderMarkdown, setRenderMarkdown] = useState(false);
  return (
    <>
      <div className="modal-body">
        <div className="field">
          <label>{t('workshop.wbName')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('workshop.wbNamePh')} />
        </div>
        <div className="field" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <label>{t('workshop.wbContentLabel')}</label>
            <div className="raw-wrap-toggle">
              <span className="raw-wrap-label">{t('workshop.wbMarkdownRender')}</span>
              <label className="switch">
                <input type="checkbox" checked={renderMarkdown} onChange={(e) => setRenderMarkdown(e.target.checked)} />
                <span className="switch-slider" />
              </label>
            </div>
          </div>
          {!renderMarkdown ? (
            <textarea className="textarea grow-textarea" value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('workshop.wbContentPh')} />
          ) : (
            <div className="bubble preview-scroll wb-render-pane">
              {content ? <Markdown text={content} /> : <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>{t('workshop.wbContentPh')}</span>}
            </div>
          )}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary" onClick={() => onSave(name, content)}>{t('common.save')}</button>
      </div>
    </>
  );
}

// ---------------- 技能表 ----------------

/** 技能来源排序：内置 → 自定义 → 导入（组内保持 DB 顺序） */
function toolOrigin(t: McpTool): 'builtin' | 'custom' | 'imported' {
  return t.origin ?? (t.isBuiltIn ? 'builtin' : 'custom');
}

/** 保留在分组内的横向（拖动过程中，卡片实际拖动时不会离开组） */
function SkillList({ onChanged }: { onChanged: () => void }) {
  const tools = useStore((s) => s.tools);
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const refresh = useStore((s) => s.refreshTools);
  const [pendingDelete, setPendingDelete] = useState<McpTool | null>(null);
  const [detail, setDetail] = useState<McpTool | null>(null);

  const [custom, setCustom] = useState<McpTool[]>([]);
  const [imported, setImported] = useState<McpTool[]>([]);
  const [builtin, setBuiltin] = useState<McpTool[]>([]);

  // 从 store 同步分组（store 中 tools 已按 displayOrder 排序）
  useEffect(() => {
    const groups: Record<'custom' | 'imported' | 'builtin', McpTool[]> = { custom: [], imported: [], builtin: [] };
    for (const tt of tools) {
      const g = toolOrigin(tt);
      if (groups[g]) groups[g].push(tt);
    }
    setCustom(groups.custom);
    setImported(groups.imported);
    setBuiltin(groups.builtin);
  }, [tools]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const deleteTool = async (tt: McpTool) => {
    await db.tools.delete(tt.id!);
    await refresh();
    onChanged();
    addToast(t('toast.skillDeleted'));
  };

  /** 拖拽结束：仅在同一分组内重排（各组用独立的 SortableContext），随后持久化 */
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromId = active.id as string;
    const toId = over.id as string;

    /** 在指定分组内搬移并持久化 displayOrder（0..n-1） */
    const apply = (group: McpTool[], setter: React.Dispatch<React.SetStateAction<McpTool[]>>): boolean => {
      const from = group.findIndex((x) => x.name === fromId);
      const to = group.findIndex((x) => x.name === toId);
      if (from < 0 || to < 0) return false;
      const next = arrayMove(group, from, to);
      setter(next);
      for (let i = 0; i < next.length; i++) {
        const item = next[i];
        if (item.id != null) db.tools.update(item.id, { displayOrder: i });
      }
      refresh();
      return true;
    };

    if (!apply(custom, setCustom)) {
      if (!apply(imported, setImported)) {
        if (builtin.some((x) => x.name === fromId)) apply(builtin, setBuiltin);
      }
    }
  };

  const groupConfig: { key: 'builtin' | 'custom' | 'imported'; labelKey: string; items: McpTool[]; setter: React.Dispatch<React.SetStateAction<McpTool[]>> }[] = [
    { key: 'custom', labelKey: 'workshop.skillGroupCustom', items: custom, setter: setCustom },
    { key: 'imported', labelKey: 'workshop.skillGroupImported', items: imported, setter: setImported },
    { key: 'builtin', labelKey: 'workshop.skillGroupBuiltin', items: builtin, setter: setBuiltin },
  ];

  const renderRow = (tt: McpTool) => {
    let desc = '';
    try {
      desc = (JSON.parse(tt.jsonContent) as { function?: { description?: string } }).function?.description ?? '';
    } catch { /* ignore */ }
    let impl = 'native';
    if (tt.executionJson) {
      try {
        impl = (JSON.parse(tt.executionJson) as { type?: string }).type ?? 'invalid';
      } catch { impl = 'invalid'; }
    }
    return (
      <SkillSortItem key={tt.name} tool={tt} desc={desc} impl={impl} onDetail={() => setDetail(tt)} onDelete={() => setPendingDelete(tt)} />
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="skill-sort-hint">
        <Icon name="sort" size={12} /> {t('workshop.sortHint')}
      </div>
      {groupConfig.map((g) => (
        <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="group-label">{t(g.labelKey, { n: g.items.length })}</span>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={g.items.map((x) => x.name)} strategy={verticalListSortingStrategy}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.items.map(renderRow)}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      ))}
      {detail && <SkillDetailModal tool={detail} onClose={() => setDetail(null)} />}
      {pendingDelete && (
        <DeleteConfirmDialog
          title={t('workshop.deleteSkillTitle')}
          itemName={pendingDelete.name}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteTool(pendingDelete)}
        />
      )}
    </div>
  );
}

/** 单个技能卡片：复用 .list-item 样式，整卡可拖拽排序（无手柄） */
function SkillSortItem({
  tool,
  desc,
  impl,
  onDetail,
  onDelete,
}: {
  tool: McpTool;
  desc: string;
  impl: string;
  onDetail: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tool.name });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`list-item sortable-skill ${isDragging ? 'dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      <div style={{ fontSize: 18 }}>{tool.isBuiltIn ? '🧰' : '⚙️'}</div>
      <div className="l-main">
        <div className="l-title">
          {tool.name}
          {tool.isBuiltIn && <span className="tag" style={{ marginLeft: 8 }}>{t('common.builtin')}</span>}
        </div>
        <div className="l-sub">{desc}</div>
        {impl !== 'native' && <div style={{ fontSize: 10.5, marginTop: 2, color: 'var(--warn)' }}>{t('workshop.implType', { t: impl })}</div>}
      </div>
      <div className="skill-item-actions">
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); onDetail(); }} title={t('workshop.viewDetails')}>
          <Icon name="file" size={12} /> {t('workshop.viewDetails')}
        </button>
        <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); onDelete(); }} disabled={tool.isBuiltIn}>
          <Icon name="trash" size={12} />
        </button>
      </div>
    </div>
  );
}

// ---------------- 技能详情 ----------------

function SkillDetailModal({ tool, onClose }: { tool: McpTool; onClose: () => void }) {
  const t = useT();
  let parsed: { function?: { name?: string; description?: string; parameters?: unknown } } | null = null;
  try {
    parsed = JSON.parse(tool.jsonContent) as { function?: { name?: string; description?: string; parameters?: unknown } };
  } catch { /* 保持 null */ }
  let exec: unknown = null;
  let execType = 'native';
  if (tool.executionJson) {
    try {
      exec = JSON.parse(tool.executionJson);
      execType = (exec as { type?: string }).type ?? 'unknown';
    } catch { exec = null; execType = 'invalid'; }
  }
  const description = parsed?.function?.description ?? '';
  const parameters = parsed?.function?.parameters;

  return (
    <Modal onClose={onClose} width={620}>
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 15 }}>
          {t('workshop.skillDetails')} · <span className="mono">{tool.name}</span>
          {tool.isBuiltIn && <span className="tag" style={{ marginLeft: 8 }}>{t('common.builtin')}</span>}
        </span>
        <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {execType !== 'native' && (
          <div className="skill-detail-tag" style={{ alignSelf: 'flex-start' }}>
            {t('workshop.implType', { t: execType })}
          </div>
        )}
        <div className="field">
          <label>{t('workshop.skillDescription')}</label>
          <div className="skill-detail-text">{description || '—'}</div>
        </div>
        <div className="field">
          <label>{t('workshop.skillParameters')}</label>
          {parameters ? (
            <pre className="skill-detail-json">{JSON.stringify(parameters, null, 2)}</pre>
          ) : (
            <div className="skill-detail-text" style={{ color: 'var(--text-faint)' }}>{t('workshop.skillNoParams')}</div>
          )}
        </div>
        <div className="field">
          <label>{t('workshop.skillExecution')}</label>
          {exec ? (
            <pre className="skill-detail-json">{JSON.stringify(exec, null, 2)}</pre>
          ) : (
            <div className="skill-detail-text" style={{ color: 'var(--text-faint)' }}>{t('workshop.skillNoExecution')}</div>
          )}
        </div>
        <div className="field">
          <label>{t('workshop.skillRawJson')}</label>
          <pre className={`skill-detail-json${parsed ? '' : ' err'}`}>{parsed ? JSON.stringify(parsed, null, 2) : t('workshop.skillBadJson')}</pre>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn btn-primary" onClick={onClose}>{t('common.close')}</button>
      </div>
    </Modal>
  );
}