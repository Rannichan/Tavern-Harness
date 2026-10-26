import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSortableSensors } from '../core/sortableSensors';
import { useStore } from '../store/store';
import {
  BUILTIN_TAVERN_HANDBOOK_CONTENT,
  builtinTavernHandbookName,
  db,
  isBuiltinTavernHandbook,
} from '../db/database';
import type { NpcCharacter, WorldBook, McpTool } from '../types/models';
import { Avatar, Icon, MasonryGrid, Markdown, Modal } from './shared';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { parseSillyTavernCardFile } from '../core/sillyTavernImporter';
import { parseSillyTavernWorldInfoFile } from '../core/sillyTavernWorldInfo';
import { characterBookEntryStats } from '../core/characterBook';
import { textPreview } from '../core/textPreview';
import { AVATAR_STORAGE_SIZE, shrinkAvatarDataUrl } from '../core/avatarThumbnail';
import { ALL_BUILTIN_TOOL_NAMES } from '../core/toolDefinitions';
import { useT } from '../core/i18n';
import { unlockAchievement } from '../core/achievements';

const CharacterBookEditor = lazy(() => import('./CharacterBookEditor'));

type WorkshopTab = 'characters' | 'worldbooks' | 'skills';

// 内置角色「酒馆老板」默认启用所有技能
const ALL_DEFAULT_SKILLS = [...ALL_BUILTIN_TOOL_NAMES];

// ============================================================
// 角色工坊（NPC 管理 / Lorebook / 技能表 / PNG 导入）
// 说明：PNG 导入只解析不落库，打开「新建角色」表单预填，
//       由用户手动点保存
// ============================================================

export const CharactersView = memo(function CharactersView({ active = true }: { active?: boolean }) {
  const npcs = useStore((s) => s.npcs);
  const worldBooks = useStore((s) => s.worldBooks);
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [tab, setTab] = useState<WorkshopTab>('characters');
  // 懒挂载 + 常驻（与 App.tsx 的 ViewSlot 同一思路）：tab 一旦打开过就不再卸载。
  // 角色卡 / 世界书卡片带着大段文本和头像背景图，反复重建会把排版和解码
  // 成本重复付一遍，表现就是每次切换都卡一下。
  const [mountedTabs, setMountedTabs] = useState<ReadonlySet<WorkshopTab>>(
    () => new Set<WorkshopTab>(['characters']),
  );
  const selectTab = (next: WorkshopTab) => {
    setTab(next);
    setMountedTabs((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  };
  const [editing, setEditing] = useState<NpcCharacter | null>(null);
  const [isNew, setIsNew] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => fileRef.current?.click();

  const refresh = useStore((s) => s.refreshNpcs);
  const refreshWb = useStore((s) => s.refreshWorldBooks);
  const refreshTools = useStore((s) => s.refreshTools);

  // 视图常驻时按激活状态刷新。
  useEffect(() => {
    if (!active) return;
    void refresh();
    void refreshWb();
    void refreshTools();
  }, [active, refresh, refreshWb, refreshTools]);

  const handleImport = async (file: File) => {
    try {
      const draft = await parseSillyTavernCardFile(file);
      const avatarDataUrl = await shrinkAvatarDataUrl(draft.character.avatarDataUrl, AVATAR_STORAGE_SIZE);
      setEditing({ ...draft.character, avatarDataUrl, id: undefined });
      setIsNew(true);
      addToast(t('toast.importedChar', { name: draft.character.name, version: draft.version }));
    } catch (e) {
      addToast(t('toast.importFailed', { msg: (e as Error).message }), 'error');
    }
  };

  return (
    <div className="view-page workshop-page">
      <div className="view-col">
        <div>
          <h2 className="view-title">{t('workshop.title')}</h2>
          <p className="view-sub">{t('workshop.sub')}</p>
        </div>
        <div className="side-nav" data-hscroll>
          <button className={`nav-chip ${tab === 'characters' ? 'active' : ''}`} onClick={() => selectTab('characters')}>
            {t('workshop.tabCharacters')}
          </button>
          <button className={`nav-chip ${tab === 'worldbooks' ? 'active' : ''}`} onClick={() => selectTab('worldbooks')}>
            {t('workshop.tabWorldbooks')}
          </button>
          <button className={`nav-chip ${tab === 'skills' ? 'active' : ''}`} onClick={() => selectTab('skills')}>
            {t('workshop.tabSkills')}
          </button>
        </div>

        <div className="workshop-tab-panel" data-active={tab === 'characters' ? 'true' : 'false'}>
          <CharacterGrid
            npcs={npcs}
            onEdit={(n, isNew) => {
              setEditing(n);
              setIsNew(isNew);
            }}
            onImportPng={openFilePicker}
          />
        </div>
        <div className="workshop-tab-panel" data-active={tab === 'worldbooks' ? 'true' : 'false'}>
          {mountedTabs.has('worldbooks') && <WorldBookList books={worldBooks} onChanged={refreshWb} />}
        </div>
        <div className="workshop-tab-panel" data-active={tab === 'skills' ? 'true' : 'false'}>
          {mountedTabs.has('skills') && <SkillList />}
        </div>
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
          }}
          onSaved={() => {
            refresh();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
});

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
            <img className="btn-logo-icon" src="/sillytavern-logo.png" alt="" /> {t('workshop.pngImport')}
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
      <MasonryGrid>
        {npcs.map((n) => (
          <div key={n.id} className="char-card fade-up">
            <div className="cname">
              <Avatar name={n.name} colorOrdinal={n.avatarColorOrdinal} imageUrl={n.avatarDataUrl} size="xs" />
              <ScrollingCardName name={n.name} />
              {n.isBuiltIn && <span className="tag">{t('common.builtin')}</span>}
            </div>
            <div className="cgreet">{textPreview(n.greeting) || t('workshop.noGreeting')}</div>
            {/* 技能区固定渲染（哪怕无技能），保证所有卡片高度一致 */}
            <div className="cskil">
              {n.enabledToolNames.map((s) => (
                <span key={s} className="skill-tag">{s}</span>
              ))}
            </div>
            <div className="cactions">
              <button className="btn btn-sm" onClick={() => onEdit(n, false)}><Icon name="settings" size={12} /> {t('workshop.browseEdit')}</button>
              <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(n)} disabled={n.isBuiltIn} title={n.isBuiltIn ? t('workshop.protectedTip') : t('common.delete')}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          </div>
        ))}
      </MasonryGrid>
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
  const [characterBook, setCharacterBook] = useState(npc.characterBook ?? '');
  const [editorTab, setEditorTab] = useState<'character' | 'knowledge'>('character');
  const [renderMarkdown, setRenderMarkdown] = useState(false);
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

  const resetToDefault = () => {
    setName(npc.name);
    setPrompt(t('builtinNpc.prompt'));
    setGreetings([t('builtinNpc.greeting')]);
    setEnabledToolNames([...ALL_DEFAULT_SKILLS]);
  };

  const save = async () => {
    if (!name.trim()) {
      addToast(t('toast.nameRequired'), 'error');
      return;
    }
    if (characterBook.trim()) {
      try {
        JSON.parse(characterBook);
      } catch {
        addToast(t('toast.characterBookInvalidJson'), 'error');
        return;
      }
    }
    // 清理空白/重复项：第一项作为主开场白，其余作为备用
    const cleaned = greetings.map((g) => g.trim()).filter((g, i, arr) => g && arr.indexOf(g) === i);
    const npcData = {
      name: npc.isBuiltIn ? npc.name : name.trim(),
      prompt,
      characterBook: characterBook.trim() || undefined,
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
      await unlockAchievement('creator');
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
    <Modal onClose={onClose} className="modal-editor editor-modal-with-tabs character-editor-modal">
      <div className="modal-head">
            <span style={{ fontWeight: 800, fontSize: 15 }}>{isNew ? t('workshop.newCharTitle') : t('workshop.editCharTitle')}</span>
            <div className="raw-tabs">
              <button className={`raw-tab ${editorTab === 'character' ? 'active' : ''}`} onClick={() => setEditorTab('character')}>{t('workshop.characterTab')}</button>
              <button
                className={`raw-tab ${editorTab === 'knowledge' ? 'active' : ''}`}
                onClick={() => setEditorTab('knowledge')}
              >
                {t('workshop.knowledgeTab')}
              </button>
            </div>
            <div className="modal-head-actions">
              <div className="raw-wrap-toggle">
                <span className="raw-wrap-label">{t('workshop.wbMarkdownRender')}</span>
                <label className="switch">
                  <input type="checkbox" checked={renderMarkdown} onChange={(e) => setRenderMarkdown(e.target.checked)} />
                  <span className="switch-slider" />
                </label>
              </div>
              <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
            </div>
          </div>
          <div className={`modal-body character-editor-body ${editorTab === 'knowledge' ? 'knowledge-tab' : ''}`}>
            {editorTab === 'character' && <>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <Avatar name={name || t('chat.speakerChar')} colorOrdinal={npc.avatarColorOrdinal} imageUrl={avatarDataUrl} size="sm" />
              <div style={{ display: 'flex', gap: 8 }}>
                <label className="btn btn-sm" style={{ cursor: 'pointer', position: 'relative' }}>
                  {t('workshop.uploadAvatar')}
                  <input type="file" accept="image/*" hidden onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      const reader = new FileReader();
                      reader.onload = () => {
                        const raw = reader.result as string;
                        void shrinkAvatarDataUrl(raw, AVATAR_STORAGE_SIZE).then((url) => setAvatarDataUrl(url));
                      };
                      reader.readAsDataURL(f);
                    }
                  }} />
                </label>
                {avatarDataUrl && <button className="btn btn-sm btn-ghost" onClick={() => setAvatarDataUrl(null)}>{t('common.clear')}</button>}
              </div>
            </div>
            <div className="field">
              <label>{t('workshop.name')}</label>
              {npc.isBuiltIn
                ? <div className="skill-detail-text">{name}</div>
                : <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('workshop.charNamePh')} />}
            </div>
            <div className="field prompt-field">
              <label>{t('workshop.promptLabel')}</label>
              {!renderMarkdown ? (
                <textarea className="textarea grow-textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('workshop.promptPh')} />
              ) : (
                <div className="bubble preview-scroll wb-render-pane char-prompt-render-pane">
                  {prompt ? <Markdown text={prompt} /> : <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>{t('workshop.promptPh')}</span>}
                </div>
              )}
            </div>
            <div className="field" style={{ flexShrink: 0 }}>
              <label>
                {t('workshop.greetingLabel')}
                <span> {t('workshop.greetingRandomHint')}</span>
              </label>
              {greetings.map((g, i) => (
                <div key={i} className="greeting-input">
                  {!renderMarkdown ? (
                    <textarea
                      className="textarea grow-textarea greeting-grow"
                      value={g}
                      onChange={(e) => setGreetings((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                      placeholder={t('workshop.greetingPh')}
                    />
                  ) : (
                    <div className="bubble preview-scroll wb-render-pane greeting-render-pane">
                      {g ? <Markdown text={g} /> : <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>{t('workshop.greetingPh')}</span>}
                    </div>
                  )}
                  {!renderMarkdown && (
                    <button
                      className="icon-btn greeting-del"
                      title={t('common.delete')}
                      onClick={() => setGreetings((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  )}
                </div>
              ))}
              {!renderMarkdown && (
                <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setGreetings((prev) => [...prev, ''])}>
                  <Icon name="plus" size={12} /> {t('workshop.addAltGreeting')}
                </button>
              )}
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
            </>}
            {editorTab === 'knowledge' && (
              <div className="field prompt-field character-book-field">
                <label>{t('workshop.characterBookLabel')}</label>
                <Suspense fallback={<div className="character-book-editor-loading" />}>
                  <CharacterBookEditor
                    value={characterBook}
                    onChange={setCharacterBook}
                    placeholder={t('workshop.characterBookPh')}
                  />
                </Suspense>
              </div>
            )}
          </div>
          <div className="modal-foot">
            {npc.isBuiltIn && (
              <button className="btn" type="button" onClick={resetToDefault} title={t('workshop.resetCharTip')}>
                <Icon name="refresh" size={12} /> {t('workshop.resetChar')}
              </button>
            )}
            <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
          </div>
    </Modal>
  );
}

// ---------------- Lorebook ----------------

type WorldBookDraft = WorldBook | {
  name: string;
  content: string;
  characterBook?: string;
  imageUri: null;
  createdAt: number;
};

function WorldBookList({ books, onChanged }: {
  books: WorldBook[];
  onChanged: () => void;
}) {
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [editing, setEditing] = useState<WorldBookDraft | null>(null);
  const [editorTab, setEditorTab] = useState<'worldbook' | 'knowledge'>('worldbook');
  const [pendingDelete, setPendingDelete] = useState<WorldBook | null>(null);
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const statsByBook = useMemo(() => {
    const map = new Map<number, { total: number; enabled: number }>();
    for (const book of books) {
      if (book.id != null) map.set(book.id, characterBookEntryStats(book.characterBook));
    }
    return map;
  }, [books]);

  const closeEditor = () => {
    setEditing(null);
  };

  const openEditor = (draft: WorldBookDraft, tab: 'worldbook' | 'knowledge' = 'worldbook') => {
    setEditorTab(tab);
    setEditing(draft);
  };

  const saveWb = async (name: string, content: string, characterBook: string) => {
    const knowledge = characterBook.trim();
    if (!name.trim()) {
      addToast(t('toast.wbNameRequired'), 'error');
      return;
    }
    if (!content.trim() && !knowledge) {
      addToast(t('toast.wbNameContentRequired'), 'error');
      return;
    }
    if (knowledge) {
      try {
        JSON.parse(knowledge);
      } catch {
        addToast(t('toast.knowledgeInvalidJson'), 'error');
        return;
      }
    }
    const data = {
      name: name.trim(),
      content,
      characterBook: knowledge || undefined,
    };
    if (editing && 'id' in editing && editing.id != null) {
      await db.worldBooks.update(editing.id, data);
      addToast(t('toast.wbUpdated'));
    } else {
      await db.worldBooks.add({ ...data, imageUri: null, createdAt: Date.now() });
      await unlockAchievement('creator');
      addToast(t('toast.wbCreated'));
    }
    setEditing(null);
    onChanged();
  };

  const importWorldInfo = async (file: File) => {
    try {
      const imported = await parseSillyTavernWorldInfoFile(file, t('workshop.importedWbName'));
      // 与 PNG 角色卡导入一致：只预填草稿，由用户确认后保存。
      openEditor({
        name: imported.name,
        content: imported.content,
        characterBook: imported.characterBook,
        imageUri: null,
        createdAt: Date.now(),
      }, 'knowledge');
      addToast(t('toast.wbImported', {
        name: imported.name,
        total: imported.entryCount,
        enabled: imported.enabledEntryCount,
      }));
    } catch (e) {
      addToast(t('toast.wbImportFailed', { msg: (e as Error).message }), 'error');
    }
  };

  const deleteWb = async (b: WorldBook) => {
    if (isBuiltinTavernHandbook(b)) return;
    await db.worldBooks.delete(b.id!);
    addToast(t('toast.wbDeleted'));
    onChanged();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span className="group-label" style={{ margin: 0 }}>{t('workshop.wbCount', { n: books.length })}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={() => jsonFileRef.current?.click()} title={t('workshop.jsonImportTip')}>
            <img className="btn-logo-icon" src="/sillytavern-logo.png" alt="" /> {t('workshop.jsonImport')}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => openEditor({ name: '', content: '', imageUri: null, createdAt: Date.now() })}>
            <Icon name="plus" size={13} /> {t('workshop.newWb')}
          </button>
        </div>
      </div>
      <input
        ref={jsonFileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importWorldInfo(f);
          e.target.value = '';
        }}
      />
      {books.length === 0 && (
        <div className="empty-state">
          <div className="big">📖</div>
          {t('workshop.wbEmpty')}
        </div>
      )}
      <MasonryGrid>
        {books.map((b) => {
          const isBuiltin = isBuiltinTavernHandbook(b);
          const knowledge = (b.id != null ? statsByBook.get(b.id) : undefined) ?? { total: 0, enabled: 0 };
          const meta = [
            b.content ? t('workshop.wbChars', { n: b.content.length }) : '',
            knowledge.total > 0 ? t('workshop.wbKnowledgeMeta', { enabled: knowledge.enabled, total: knowledge.total }) : '',
          ].filter(Boolean).join(' · ');
          return (
            <div key={b.id} className="char-card wb-card fade-up">
              <div className="cname">
                <span style={{ fontSize: 16 }}>📖</span>
                <ScrollingCardName name={b.name} />
                {isBuiltin && <span className="tag">{t('common.builtin')}</span>}
              </div>
              <div className="wcontent">{textPreview(b.content) || t('workshop.wbNoContent')}</div>
              <div className="cmeta">{meta}</div>
              <div className="cactions">
                <button className="btn btn-sm" onClick={() => openEditor(b)}><Icon name="settings" size={12} /> {t('workshop.browseEdit')}</button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => setPendingDelete(b)}
                  disabled={isBuiltin}
                  title={isBuiltin ? t('workshop.protectedTip') : t('common.delete')}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </MasonryGrid>

      {pendingDelete && (
        <DeleteConfirmDialog
          title={t('workshop.deleteWbTitle')}
          itemName={pendingDelete.name}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteWb(pendingDelete)}
        />
      )}

      {editing && (
        <Modal onClose={closeEditor} className="modal-editor editor-modal-with-tabs">
          <WorldBookForm
            initial={editing}
            tab={editorTab}
            onTabChange={setEditorTab}
            onSave={saveWb}
            onClose={closeEditor}
          />
        </Modal>
      )}
    </div>
  );
}

function ScrollingCardName({ name }: { name: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const updateOverflow = () => {
      setOverflowing((textRef.current?.scrollWidth ?? 0) > (containerRef.current?.clientWidth ?? 0));
    };
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [name]);

  return (
    <span ref={containerRef} className={`cname-text card-name-scroll${overflowing ? ' is-overflowing' : ''}`}>
      <span ref={textRef} className="card-name-scroll-text">{name}</span>
      {overflowing && <span className="card-name-scroll-text card-name-scroll-copy" aria-hidden="true">{name}</span>}
    </span>
  );
}

function WorldBookForm({
  initial,
  tab,
  onTabChange,
  onSave,
  onClose,
}: {
  initial: WorldBookDraft;
  tab: 'worldbook' | 'knowledge';
  onTabChange: (tab: 'worldbook' | 'knowledge') => void;
  onSave: (n: string, c: string, k: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial.name);
  const [content, setContent] = useState(initial.content);
  const [characterBook, setCharacterBook] = useState(initial.characterBook ?? '');
  const [renderMarkdown, setRenderMarkdown] = useState(false);
  const isBuiltin = isBuiltinTavernHandbook(initial);
  const knowledge = useMemo(() => characterBookEntryStats(characterBook), [characterBook]);
  const isEditing = 'id' in initial && initial.id != null;

  const resetToDefault = () => {
    setName(builtinTavernHandbookName());
    setContent(BUILTIN_TAVERN_HANDBOOK_CONTENT);
    setCharacterBook('');
  };

  /** 批量启用/停用知识库条目（SillyTavern 导入的条目可能默认停用）。 */
  const setAllEntriesEnabled = (enabled: boolean) => {
    try {
      const parsed: unknown = JSON.parse(characterBook);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const record = parsed as Record<string, unknown>;
      if (!Array.isArray(record.entries)) return;
      const entries = record.entries.map((entry) => (
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? { ...entry as Record<string, unknown>, enabled }
          : entry
      ));
      setCharacterBook(JSON.stringify({ ...record, entries }, null, 2));
    } catch {
      // 无效 JSON 在保存时统一提示
    }
  };
  return (
    <>
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 15 }}>
          {isEditing ? t('workshop.editWbTitle') : t('workshop.newWbTitle')}
        </span>
        <div className="raw-tabs">
          <button className={`raw-tab ${tab === 'worldbook' ? 'active' : ''}`} onClick={() => onTabChange('worldbook')}>
            {t('workshop.worldBookTab')}
          </button>
          <button className={`raw-tab ${tab === 'knowledge' ? 'active' : ''}`} onClick={() => onTabChange('knowledge')}>
            {t('workshop.knowledgeTab')}
          </button>
        </div>
        <div className="modal-head-actions">
          {tab === 'worldbook' && (
            <div className="raw-wrap-toggle">
              <span className="raw-wrap-label">{t('workshop.wbMarkdownRender')}</span>
              <label className="switch">
                <input type="checkbox" checked={renderMarkdown} onChange={(e) => setRenderMarkdown(e.target.checked)} />
                <span className="switch-slider" />
              </label>
            </div>
          )}
          <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
        </div>
      </div>
      <div className={`modal-body ${tab === 'knowledge' ? 'knowledge-tab' : ''}`}>
        {tab === 'worldbook' && <>
          <div className="field">
            <label>{t('workshop.wbName')}</label>
            {isBuiltin
              ? <div className="skill-detail-text">{name}</div>
              : <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('workshop.wbNamePh')}
                />}
          </div>
          <div className="field" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <label>{t('workshop.wbContentLabel')}</label>
            {!renderMarkdown ? (
              <textarea className="textarea grow-textarea" value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('workshop.wbContentPh')} />
            ) : (
              <div className="bubble preview-scroll wb-render-pane">
                {content ? <Markdown text={content} /> : <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>{t('workshop.wbContentPh')}</span>}
              </div>
            )}
          </div>
        </>}
        {tab === 'knowledge' && (
          <div className="field prompt-field character-book-field">
            <label>{t('workshop.wbKnowledgeLabel')}</label>
            {knowledge.total > 0 && (
              <div className="knowledge-bulk-actions">
                <span>{t('workshop.wbKnowledgeMeta', { enabled: knowledge.enabled, total: knowledge.total })}</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAllEntriesEnabled(true)}>
                  {t('workshop.knowledgeEnableAll')}
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAllEntriesEnabled(false)}>
                  {t('workshop.knowledgeDisableAll')}
                </button>
              </div>
            )}
            <Suspense fallback={<div className="character-book-editor-loading" />}>
              <CharacterBookEditor
                value={characterBook}
                onChange={setCharacterBook}
                placeholder={t('workshop.wbKnowledgePh')}
              />
            </Suspense>
          </div>
        )}
      </div>
      <div className="modal-foot">
        {isBuiltin && (
          <button className="btn" type="button" onClick={resetToDefault} title={t('workshop.resetWbTip')}>
            <Icon name="refresh" size={12} /> {t('workshop.resetWb')}
          </button>
        )}
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn btn-primary" onClick={() => onSave(name, content, characterBook)}>{t('common.save')}</button>
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
function SkillList() {
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

  const sensors = useSortableSensors();

  const deleteTool = async (tt: McpTool) => {
    await db.tools.delete(tt.id!);
    await refresh();
    addToast(t('toast.skillDeleted'));
  };

  /** 拖拽结束：仅在同一分组内重排（各组用独立的 SortableContext），随后持久化 */
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromId = active.id as string;
    const toId = over.id as string;

    /** 在指定分组内搬移并持久化 displayOrder（0..n-1） */
    const apply = async (group: McpTool[], setter: React.Dispatch<React.SetStateAction<McpTool[]>>): Promise<boolean> => {
      const from = group.findIndex((x) => x.name === fromId);
      const to = group.findIndex((x) => x.name === toId);
      if (from < 0 || to < 0) return false;
      const next = arrayMove(group, from, to);
      setter(next);
      try {
        // 必须先等所有写入落库再 refresh：持久化层是远程 SQLite（每次 update
        // 还要先取写锁），立即 refresh 会读到旧顺序，再用 store 的旧数据把刚
        // 拖好的界面覆盖回去，表现就是松手后弹回原位。
        await Promise.all(next.map((item, index) => (
          item.id == null ? Promise.resolve() : db.tools.update(item.id, { displayOrder: index })
        )));
      } catch (error) {
        addToast(t('toast.skillOrderFailed', { msg: (error as Error).message }), 'error');
      } finally {
        // 失败时也刷新：让界面回到数据库里的真实顺序，而不是停留在乐观结果。
        await refresh();
      }
      return true;
    };

    void (async () => {
      if (await apply(custom, setCustom)) return;
      if (await apply(imported, setImported)) return;
      if (builtin.some((x) => x.name === fromId)) await apply(builtin, setBuiltin);
    })();
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
          <span className="skill-card-name">{tool.name}</span>
          {tool.isBuiltIn && <span className="tag">{t('common.builtin')}</span>}
        </div>
        <div className="l-sub">{desc}</div>
        {tool.isBuiltIn && impl !== 'native' && <div style={{ fontSize: 10.5, marginTop: 2, color: 'var(--warn)' }}>{t('workshop.implType', { t: impl })}</div>}
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
  const refreshTools = useStore((s) => s.refreshTools);
  const editable = !tool.isBuiltIn;
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

  const initialParameters = parsed?.function?.parameters ?? { type: 'object', properties: {} };
  const [name, setName] = useState(parsed?.function?.name ?? tool.name);
  const [description, setDescription] = useState(parsed?.function?.description ?? '');
  const [parametersText, setParametersText] = useState(() => JSON.stringify(initialParameters, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const schema = useMemo(() => {
    try {
      const value: unknown = JSON.parse(parametersText);
      if (!value || Array.isArray(value) || typeof value !== 'object' || (value as { type?: unknown }).type !== 'object') return { error: t('workshop.skillSchemaObject') };
      return { value: value as Record<string, unknown> };
    } catch {
      return { error: t('workshop.skillSchemaJson') };
    }
  }, [parametersText, t]);
  const rawJson = schema.value
    ? JSON.stringify({ type: 'function', function: { name, description, parameters: schema.value } }, null, 2)
    : null;

  const save = async () => {
    if (!schema.value) {
      setError(schema.error ?? t('workshop.skillSchemaJson'));
      return;
    }
    if (!/^[a-z][a-z0-9_]{2,39}$/.test(name)) {
      setError(t('workshop.skillNameInvalid'));
      return;
    }
    if (description.length > 500) {
      setError(t('workshop.skillDescriptionLong'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const existing = await db.tools.where('name').equals(name).first();
      if (existing && existing.id !== tool.id) {
        setError(t('workshop.skillNameExists'));
        return;
      }
      const updated = { ...tool, name, jsonContent: rawJson! };
      await db.transaction('rw', db.tools, db.npcs, async () => {
        await db.tools.put(updated);
        if (name !== tool.name) {
          const npcs = await db.npcs.toArray();
          await Promise.all(npcs
            .filter((npc) => npc.enabledToolNames.includes(tool.name))
            .map((npc) => db.npcs.update(npc.id!, {
              enabledToolNames: npc.enabledToolNames.map((toolName) => toolName === tool.name ? name : toolName),
            })));
        }
      });
      await refreshTools();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div className="modal-head">
        <span style={{ fontWeight: 800, fontSize: 15 }}>
          {t('workshop.skillDetails')}
          {tool.isBuiltIn && <span className="tag" style={{ marginLeft: 8 }}>{t('common.builtin')}</span>}
          {!tool.isBuiltIn && execType !== 'native' && <span className="tag" style={{ marginLeft: 8 }}>{t('workshop.implType', { t: execType })}</span>}
        </span>
        <button className="icon-btn" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label>{t('workshop.skillName')}</label>
          {editable ? <input className="input" value={name} onChange={(e) => setName(e.target.value)} /> : <div className="skill-detail-text">{name}</div>}
        </div>
        <div className="field">
          <label>{t('workshop.skillDescription')}</label>
          {editable ? <textarea className="textarea skill-detail-textarea" value={description} maxLength={500} wrap="soft" onChange={(e) => setDescription(e.target.value)} /> : <div className="skill-detail-text">{description || '—'}</div>}
        </div>
        <div className="field">
          <label>{t('workshop.skillParameters')}</label>
          {editable ? <textarea className="textarea mono skill-detail-textarea" value={parametersText} wrap="soft" spellCheck={false} onChange={(e) => setParametersText(e.target.value)} /> : parametersText ? <pre className="skill-detail-json">{parametersText}</pre> : <div className="skill-detail-text" style={{ color: 'var(--text-faint)' }}>{t('workshop.skillNoParams')}</div>}
        </div>
        <div className="field">
          <label>{t('workshop.skillExecution')}</label>
          {exec ? <pre className="skill-detail-json">{JSON.stringify(exec, null, 2)}</pre> : <div className="skill-detail-text" style={{ color: 'var(--text-faint)' }}>{t('workshop.skillNoExecution')}</div>}
        </div>
        <div className="field">
          <label>{t('workshop.skillRawJson')}</label>
          <pre className={`skill-detail-json${rawJson ? '' : ' err'}`}>{rawJson ?? schema.error}</pre>
        </div>
        {error && <div className="field-hint" style={{ color: 'var(--danger)' }}>{error}</div>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn btn-primary" disabled={!editable || saving} onClick={() => void save()}>{t('common.save')}</button>
      </div>
    </Modal>
  );
}