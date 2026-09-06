import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { db } from '../db/database';
import type { NpcCharacter, WorldBook, McpTool } from '../types/models';
import { Avatar, Icon, Markdown } from './shared';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { parseSillyTavernCardFile, type ParsedSillyTavernCard } from '../core/sillyTavernImporter';
import { ALL_BUILTIN_TOOL_NAMES } from '../core/toolDefinitions';
import { useT } from '../core/i18n';

// 内置角色「酒馆老板」默认启用所有技能
const ALL_DEFAULT_SKILLS = [...ALL_BUILTIN_TOOL_NAMES];

// ============================================================
// 角色工坊（NPC 管理 / 世界书 / 技能表 / PNG 导入）
// 说明：PNG 导入只解析不落库，打开「新建角色 / 新建世界书」表单预填，
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
  // PNG 解析出的草稿：角色 + 内嵌世界书
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
        // 世界书 tab：草稿交给 WorldBookList，由 useEffect 打开预填表单（含提示）
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
        <div className="side-nav">
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
            {t('workshop.pngImport')}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              onEdit(
                {
                  name: '',
                  prompt: '',
                  greeting: '',
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
              {n.name}
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
  const [greeting, setGreeting] = useState(npc.greeting);
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
    const data: Partial<NpcCharacter> = { name: name.trim(), prompt, greeting, avatarDataUrl, enabledToolNames };
    if (isNew) {
      await db.npcs.add({
        ...npc,
        name: name.trim(),
        prompt,
        greeting,
        avatarDataUrl,
        enabledToolNames,
      });
      addToast(t('toast.charCreated', { name }));
    } else {
      await db.npcs.update(npc.id!, data);
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
              <label>{t('workshop.greetingLabel')}</label>
              <textarea className="textarea grow-textarea greeting-grow" value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder={t('workshop.greetingPh')} />
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

// ---------------- 世界书 ----------------

function WorldBookList({ books, onChanged, onImportPng, importDraft, onImportDraftConsumed }: {
  books: WorldBook[];
  onChanged: () => void;
  onImportPng: () => void;
  /** PNG 解析出的角色卡草稿（含内嵌世界书） */
  importDraft: ParsedSillyTavernCard | null;
  /** 草稿已被消费（保存/取消）后通知父组件清空 */
  onImportDraftConsumed: () => void;
}) {
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [editing, setEditing] = useState<WorldBook | { name: string; content: string; imageUri: null; createdAt: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WorldBook | null>(null);

  // PNG 导入产生草稿后：预填「新建世界书」表单（不落库，由用户手动保存）
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
            {t('workshop.pngImport')}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({ name: '', content: '', imageUri: null, createdAt: Date.now() })}>
            <Icon name="plus" size={13} /> {t('workshop.newWb')}
          </button>
        </div>
      </div>
      <div className="char-grid">
        {books.length === 0 && <div className="empty-state"><div className="big">📖</div>{t('workshop.wbEmpty')}</div>}
        {books.map((b) => (
          <div key={b.id} className="char-card wb-card fade-up">
            <div className="cname">
              <span style={{ fontSize: 16 }}>📖</span>
              {b.name}
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
  return (
    <>
      <div className="modal-body">
        <div className="field">
          <label>{t('workshop.wbName')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('workshop.wbNamePh')} />
        </div>
        <div className="field" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <label>{t('workshop.wbContentLabel')}</label>
          <textarea className="textarea grow-textarea" value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('workshop.wbContentPh')} />
        </div>
        {content && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            {t('workshop.wbPreview')}
            <div className="bubble preview-scroll" style={{ marginTop: 6, padding: '10px 14px', fontSize: 13 }}>
              <Markdown text={content.slice(0, 400)} />
            </div>
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onCancel}>{t('common.cancel')}</button>
        <button className="btn btn-primary" onClick={() => onSave(name, content)}>{t('common.save')}</button>
      </div>
    </>
  );
}

// ---------------- 技能表 ----------------

function SkillList({ onChanged }: { onChanged: () => void }) {
  const tools = useStore((s) => s.tools);
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const refresh = useStore((s) => s.refreshTools);
  const [pendingDelete, setPendingDelete] = useState<McpTool | null>(null);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const deleteTool = async (tt: McpTool) => {
    await db.tools.delete(tt.id!);
    await refresh();
    onChanged();
    addToast(t('toast.skillDeleted'));
  };

  return (
    <div>
      <span className="group-label">{t('workshop.skillCount', { n: tools.length })}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tools.map((tt) => {
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
            <div key={tt.id} className="list-item">
              <div style={{ fontSize: 18 }}>{tt.isBuiltIn ? '🧰' : '⚙️'}</div>
              <div className="l-main">
                <div className="l-title">
                  {tt.name}
                  {tt.isBuiltIn && <span className="tag" style={{ marginLeft: 8 }}>{t('common.builtin')}</span>}
                </div>
                <div className="l-sub">{desc}</div>
                {impl !== 'native' && <div style={{ fontSize: 10.5, marginTop: 2, color: 'var(--warn)' }}>{t('workshop.implType', { t: impl })}</div>}
              </div>
              <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(tt)} disabled={tt.isBuiltIn}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          );
        })}
        {tools.length === 0 && <div className="empty-state"><div className="big">🛠</div>{t('workshop.noSkills')}</div>}
      </div>
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