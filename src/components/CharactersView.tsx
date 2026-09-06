import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { db } from '../db/database';
import type { NpcCharacter, WorldBook, McpTool } from '../types/models';
import { Avatar, Icon, Markdown } from './shared';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { parseSillyTavernCardFile, type ParsedSillyTavernCard } from '../core/sillyTavernImporter';
import { ALL_BUILTIN_TOOL_NAMES } from '../core/toolDefinitions';

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
        addToast(`已解析角色卡「${draft.character.name}」(${draft.version})，请确认后保存`);
      } else {
        // 世界书 tab：草稿交给 WorldBookList，由 useEffect 打开预填表单（含提示）
        if (!draft.worldBook) {
          addToast(`该角色卡「${draft.character.name}」未包含内嵌世界书`, 'error');
        }
      }
    } catch (e) {
      addToast(`导入失败: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <div className="view-page">
      <div className="view-col">
        <div>
          <h2 className="view-title">角色工坊</h2>
          <p className="view-sub">管理 NPC、世界书与技能表，对标 SillyTavern 的角色卡流程</p>
        </div>
        <div className="side-nav">
          <button className={`nav-chip ${tab === 'characters' ? 'active' : ''}`} onClick={() => setTab('characters')}>
            👤 角色卡
          </button>
          <button className={`nav-chip ${tab === 'worldbooks' ? 'active' : ''}`} onClick={() => setTab('worldbooks')}>
            📖 世界书
          </button>
          <button className={`nav-chip ${tab === 'skills' ? 'active' : ''}`} onClick={() => setTab('skills')}>
            🛠 技能表
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
  const [pendingDelete, setPendingDelete] = useState<NpcCharacter | null>(null);

  const deleteNpc = async (n: NpcCharacter) => {
    await db.npcs.delete(n.id!);
    useStore.getState().refreshNpcs();
    addToast(`已删除角色「${n.name}」`);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="group-label" style={{ margin: 0 }}>角色卡（{npcs.length}）</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={onImportPng} title="导入 SillyTavern PNG 角色卡（chara V2 / ccv3）">
            📥 PNG 导入
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
            <Icon name="plus" size={13} /> 新建角色
          </button>
        </div>
      </div>
      <div className="char-grid">
        {npcs.map((n) => (
          <div key={n.id} className="char-card fade-up">
            <div className="cname">
              <Avatar name={n.name} colorOrdinal={n.avatarColorOrdinal} imageUrl={n.avatarDataUrl} size="xs" />
              {n.name}
              {n.isBuiltIn && <span className="tag">内置</span>}
            </div>
            <div className="cgreet">{n.greeting || '（无开场白）'}</div>
            {/* 技能区固定渲染（哪怕无技能），保证所有卡片高度一致 */}
            <div className="cskil">
              {n.enabledToolNames.map((s) => (
                <span key={s} className="skill-tag">{s}</span>
              ))}
            </div>
            <div className="cactions">
              <button className="btn btn-sm" onClick={() => onEdit(n, false)}><Icon name="settings" size={12} /> 编辑</button>
              <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(n)} disabled={n.isBuiltIn} title={n.isBuiltIn ? '内置角色受保护' : '删除'}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {pendingDelete && (
        <DeleteConfirmDialog
          title="删除角色"
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
      addToast('名称不能为空', 'error');
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
      addToast(`已创建角色「${name}」`);
    } else {
      await db.npcs.update(npc.id!, data);
      addToast(`已更新角色「${name}」`);
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
            <span style={{ fontWeight: 800, fontSize: 15 }}>{isNew ? '新建角色' : `编辑角色 · ${npc.name}`}</span>
            <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
          </div>
          <div className="modal-body">
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <Avatar name={name || '角色'} colorOrdinal={npc.avatarColorOrdinal} imageUrl={avatarDataUrl} size="sm" />
              <div style={{ display: 'flex', gap: 8 }}>
                <label className="btn btn-sm" style={{ cursor: 'pointer', position: 'relative' }}>
                  上传头像
                  <input type="file" accept="image/*" hidden onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      const reader = new FileReader();
                      reader.onload = () => setAvatarDataUrl(reader.result as string);
                      reader.readAsDataURL(f);
                    }
                  }} />
                </label>
                {avatarDataUrl && <button className="btn btn-sm btn-ghost" onClick={() => setAvatarDataUrl(null)}>清除</button>}
              </div>
            </div>
            <div className="field">
              <label>名称</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="角色名" />
            </div>
            <div className="field prompt-field">
              <label>人设 Prompt（注入 system prompt）</label>
              <textarea className="textarea grow-textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例如：神秘的酒馆老板，可以响应客人的任何需求" />
            </div>
            <div className="field" style={{ flexShrink: 0 }}>
              <label>开场白 Greeting</label>
              <textarea className="textarea grow-textarea greeting-grow" value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder="你来啦！快坐下~" />
            </div>
            {/* 启用技能：从卡片移入编辑页 */}
            <div className="field" style={{ flexShrink: 0 }}>
              <label>启用技能（{enabledToolNames.filter((s) => tools.some((t) => t.name === s)).length}/{tools.length}）</label>
              {tools.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>暂无技能</div>
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
            <button className="btn" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={save}>保存</button>
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
  const [editing, setEditing] = useState<WorldBook | { name: string; content: string; imageUri: null; createdAt: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WorldBook | null>(null);

  // PNG 导入产生草稿后：预填「新建世界书」表单（不落库，由用户手动保存）
  useEffect(() => {
    if (!importDraft) return;
    if (importDraft.worldBook) {
      setEditing({ ...importDraft.worldBook, imageUri: null, createdAt: Date.now() });
      addToast(`已解析角色卡内的世界书「${importDraft.worldBook.name}」，请确认后保存`);
    }
  }, [importDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeEditor = () => {
    setEditing(null);
    onImportDraftConsumed();
  };

  const saveWb = async (name: string, content: string) => {
    if (!name.trim() || !content.trim()) {
      addToast('世界书名与内容不能为空', 'error');
      return;
    }
    if (editing && 'id' in editing && editing.id != null) {
      await db.worldBooks.update(editing.id, { name: name.trim(), content });
      addToast('已更新世界书');
    } else {
      await db.worldBooks.add({ name: name.trim(), content, imageUri: null, createdAt: Date.now() });
      addToast('已创建世界书');
    }
    setEditing(null);
    onChanged();
    onImportDraftConsumed();
  };

  const deleteWb = async (b: WorldBook) => {
    await db.worldBooks.delete(b.id!);
    addToast('已删除世界书');
    onChanged();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="group-label" style={{ margin: 0 }}>世界书（{books.length}）</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={onImportPng} title="导入 SillyTavern PNG 角色卡（chara V2 / ccv3），自动解析内嵌世界书">
            📥 PNG 导入
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({ name: '', content: '', imageUri: null, createdAt: Date.now() })}>
            <Icon name="plus" size={13} /> 新建世界书
          </button>
        </div>
      </div>
      <div className="char-grid">
        {books.length === 0 && <div className="empty-state"><div className="big">📖</div>暂无世界书，为角色建立世界观吧</div>}
        {books.map((b) => (
          <div key={b.id} className="char-card wb-card fade-up">
            <div className="cname">
              <span style={{ fontSize: 16 }}>📖</span>
              {b.name}
            </div>
            <div className="wcontent">{b.content}</div>
            <div className="cmeta">{b.content.length} 字</div>
            <div className="cactions">
              <button className="btn btn-sm" onClick={() => setEditing(b)}><Icon name="settings" size={12} /> 浏览/编辑</button>
              <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(b)}><Icon name="trash" size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      {pendingDelete && (
        <DeleteConfirmDialog
          title="删除世界书"
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
                <span style={{ fontWeight: 800, fontSize: 15 }}>{'id' in editing && editing.id != null ? `编辑世界书` : '新建世界书'}</span>
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
  const [name, setName] = useState(initial.name);
  const [content, setContent] = useState(initial.content);
  return (
    <>
      <div className="modal-body">
        <div className="field">
          <label>世界书名</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：北境大陆" />
        </div>
        <div className="field" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <label>内容（附加在角色人设之后）</label>
          <textarea className="textarea grow-textarea" value={content} onChange={(e) => setContent(e.target.value)} placeholder="世界观设定文本…" />
        </div>
        {content && (
          <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            预览（Markdown 渲染）：
            <div className="bubble preview-scroll" style={{ marginTop: 6, padding: '10px 14px', fontSize: 13 }}>
              <Markdown text={content.slice(0, 400)} />
            </div>
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" onClick={() => onSave(name, content)}>保存</button>
      </div>
    </>
  );
}

// ---------------- 技能表 ----------------

function SkillList({ onChanged }: { onChanged: () => void }) {
  const tools = useStore((s) => s.tools);
  const addToast = useStore((s) => s.addToast);
  const refresh = useStore((s) => s.refreshTools);
  const [pendingDelete, setPendingDelete] = useState<McpTool | null>(null);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const deleteTool = async (t: McpTool) => {
    await db.tools.delete(t.id!);
    await refresh();
    onChanged();
    addToast('已删除技能');
  };

  return (
    <div>
      <span className="group-label">技能表（{tools.length}）</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tools.map((t) => {
          let desc = '';
          try {
            desc = (JSON.parse(t.jsonContent) as { function?: { description?: string } }).function?.description ?? '';
          } catch { /* ignore */ }
          let impl = 'native';
          if (t.executionJson) {
            try {
              impl = (JSON.parse(t.executionJson) as { type?: string }).type ?? 'invalid';
            } catch { impl = 'invalid'; }
          }
          return (
            <div key={t.id} className="list-item">
              <div style={{ fontSize: 18 }}>{t.isBuiltIn ? '🧰' : '⚙️'}</div>
              <div className="l-main">
                <div className="l-title">
                  {t.name}
                  {t.isBuiltIn && <span className="tag" style={{ marginLeft: 8 }}>内置</span>}
                </div>
                <div className="l-sub">{desc}</div>
                {impl !== 'native' && <div style={{ fontSize: 10.5, marginTop: 2, color: 'var(--warn)' }}>实现类型: {impl}</div>}
              </div>
              <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(t)} disabled={t.isBuiltIn}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          );
        })}
        {tools.length === 0 && <div className="empty-state"><div className="big">🛠</div>暂无技能</div>}
      </div>
      {pendingDelete && (
        <DeleteConfirmDialog
          title="删除技能"
          itemName={pendingDelete.name}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteTool(pendingDelete)}
        />
      )}
    </div>
  );
}