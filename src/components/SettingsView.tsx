import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../store/store';
import { db, DEFAULT_GENERATION_SETTINGS } from '../db/database';
import { type ThemeMode, type ThemePaletteId } from '../theme/theme';
import { type ApiProvider, type AppLanguage, type ImageProvider, type ImageProviderKind, type ReasoningEffort, type VoiceProvider, type VoiceProviderKind, type VoiceId, enabledModelIds, modelAliases } from '../types/models';
import { VOICE_PROVIDER_OPTIONS, previewVoice } from '../core/voice';
import { Icon, Modal } from './shared';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { isNetworkLikeError, toProxyUrl } from '../core/proxy';
import { useT } from '../core/i18n';
import { APP_VERSION, useHasUnseenVersion } from '../core/version';
import { IMAGE_MODELS } from '../core/imageGeneration';
import { VersionHistoryModal } from './VersionHistoryModal';

// ============================================================
// 设置视图（模型服务 / 超参数 / 主题）
// ============================================================

type SettingsTab = 'api' | 'model' | 'general';

export const SettingsView = memo(function SettingsView() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const addToast = useStore((s) => s.addToast);
  const resetTavern = useStore((s) => s.resetTavern);
  const providers = useStore((s) => s.providers);
  const refreshProviders = useStore((s) => s.refreshProviders);
  const voiceProviders = useStore((s) => s.voiceProviders);
  const refreshVoiceProviders = useStore((s) => s.refreshVoiceProviders);
  const imageProviders = useStore((s) => s.imageProviders);
  const refreshImageProviders = useStore((s) => s.refreshImageProviders);
  const [tab, setTab] = useState<SettingsTab>('api');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const generationSliderGesture = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startValue: number;
    direction: 'pending' | 'horizontal' | 'vertical';
  } | null>(null);
  const t = useT();
  const hasUnseenVersion = useHasUnseenVersion();

  if (!settings) return null;

  const startGenerationSliderGesture = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (event.pointerType !== 'touch') return;
    const input = event.currentTarget;
    generationSliderGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startValue: Number(input.value),
      direction: 'pending',
    };
  };

  const classifyGenerationSliderGesture = (event: ReactPointerEvent<HTMLInputElement>) => {
    const gesture = generationSliderGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.direction !== 'pending') return gesture?.direction;

    const deltaX = Math.abs(event.clientX - gesture.startX);
    const deltaY = Math.abs(event.clientY - gesture.startY);
    if (Math.max(deltaX, deltaY) < 10) return 'pending';

    gesture.direction = deltaX > deltaY ? 'horizontal' : 'vertical';
    return gesture.direction;
  };

  const endGenerationSliderGesture = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (generationSliderGesture.current?.pointerId === event.pointerId) generationSliderGesture.current = null;
  };

  const updateGenerationSlider = (key: keyof typeof settings, value: number | 'off') => {
    const gesture = generationSliderGesture.current;
    if (!gesture) {
      setSettings({ [key]: value });
    } else if (gesture.direction === 'horizontal') {
      setSettings({ [key]: value });
    } else if (gesture.direction === 'pending') {
      setSettings({ [key]: gesture.startValue });
    }
  };

  // 数字滑杆——数值显示固定在行内，不溢出卡片
  const slider = (key: keyof typeof settings, min: number, max: number, step: number, fmt?: (v: number) => string) => (
    <label className="range-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
      <input
        type="range"
        className="generation-slider"
        min={min}
        max={max}
        step={step}
        value={settings[key] as number}
        onPointerDown={startGenerationSliderGesture}
        onPointerMove={classifyGenerationSliderGesture}
        onPointerUp={endGenerationSliderGesture}
        onPointerCancel={endGenerationSliderGesture}
        onChange={(e) => updateGenerationSlider(key, parseFloat(e.target.value))}
      />
      <span className="range-val">{fmt ? fmt(settings[key] as number) : (settings[key] as number)}</span>
    </label>
  );

  const generationDefaults = DEFAULT_GENERATION_SETTINGS;
  const isGenerationDefault = (Object.keys(generationDefaults) as Array<keyof typeof generationDefaults>)
    .every((key) => settings[key] === generationDefaults[key]);

  const resetGenerationParams = async () => {
    await setSettings({ ...generationDefaults });
    addToast(t('toast.genParamsReset'));
  };
  return (
    <div className="view-page settings-page">
      <div className="view-col">
        <div>
          <h2 className="view-title">{t('settings.title')}</h2>
          <p className="view-sub">{t('settings.sub')}</p>
        </div>

        <div className="side-nav view-tabs" data-hscroll role="tablist" aria-label={t('settings.title')}>
          <button data-opening-target="api" type="button" role="tab" aria-selected={tab === 'api'} className={`nav-chip ${tab === 'api' ? 'active' : ''}`} onClick={() => setTab('api')}>
            {t('settings.tabApi')}
          </button>
          <button data-manual-four-target="model-tab" type="button" role="tab" aria-selected={tab === 'model'} className={`nav-chip ${tab === 'model' ? 'active' : ''}`} onClick={() => setTab('model')}>
            {t('settings.tabModel')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'general'} className={`nav-chip ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>
            {t('settings.tabGeneral')}
          </button>
        </div>

        <div className="settings-tab-panel" data-active={tab === 'api' ? 'true' : 'false'} role="tabpanel">
          <ProviderManager providers={providers} onChanged={refreshProviders} />
          <VoiceProviderManager providers={voiceProviders} onChanged={refreshVoiceProviders} />
          <ImageProviderManager providers={imageProviders} onChanged={refreshImageProviders} />
        </div>

        <div className="settings-tab-panel" data-active={tab === 'model' ? 'true' : 'false'} role="tabpanel">
          <div className="set-section">
          <h3>{t('settings.toolExecution')}</h3>
          <div className="set-row settings-tool-row">
            <div>
              <div className="s-label" id="yolo-mode-label">{t('settings.yoloMode')}</div>
              <div className="s-desc" id="yolo-mode-desc">{t('settings.yoloModeDesc')}</div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                aria-labelledby="yolo-mode-label"
                aria-describedby="yolo-mode-desc"
                checked={settings.yoloMode === true}
                onChange={(e) => setSettings({ yoloMode: e.target.checked })}
              />
              <span className="switch-slider" />
            </label>
          </div>
          <div className="set-row settings-tool-row" data-manual-four-target="nsfw-mode">
            <div>
              <div className="s-label" id="nsfw-mode-label">{t('settings.nsfwMode')}</div>
              <div className="s-desc" id="nsfw-mode-desc">{t('settings.nsfwModeDesc')}</div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                aria-labelledby="nsfw-mode-label"
                aria-describedby="nsfw-mode-desc"
                checked={settings.nsfwMode === true}
                onChange={(e) => {
                  setSettings({ nsfwMode: e.target.checked });
                  if (e.target.checked) window.dispatchEvent(new CustomEvent('th-manual-four-nsfw-enabled'));
                }}
              />
              <span className="switch-slider" />
            </label>
          </div>
          <div className="set-row settings-tool-row">
            <div>
              <div className="s-label" id="pure-mode-label">{t('settings.pureMode')}</div>
              <div className="s-desc" id="pure-mode-desc">{t('settings.pureModeDesc')}</div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                aria-labelledby="pure-mode-label"
                aria-describedby="pure-mode-desc"
                checked={settings.pureMode === true}
                onChange={(e) => setSettings({ pureMode: e.target.checked })}
              />
              <span className="switch-slider" />
            </label>
          </div>
        </div>

        {/* 生成参数 */}
        <div className="set-section">
          <div className="settings-section-head">
            <h3>{t('settings.genParams')}</h3>
            <button
              className="btn btn-sm settings-gen-reset"
              title={t('settings.genParamsResetTitle')}
              aria-label={t('settings.genParamsResetTitle')}
              disabled={isGenerationDefault}
              onClick={() => void resetGenerationParams()}
            >
              <Icon name="refresh" size={12} /> {t('settings.genParamsReset')}
            </button>
          </div>
          <table className="table param-table">
            <tbody>
              <tr>
                <td className="param-label">
                  <div className="s-label">Temperature</div>
                  <div className="s-desc">{t('settings.tempDesc')}</div>
                </td>
                <td>{slider('temperature', 0, 2, 0.05, (v) => v.toFixed(2))}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Top P</div>
                  <div className="s-desc">{t('settings.topPDesc')}</div>
                </td>
                <td>{slider('topP', 0, 1, 0.05, (v) => v.toFixed(2))}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Top K</div>
                  <div className="s-desc">{t('settings.topKDesc')}</div>
                </td>
                <td>{slider('topK', 0, 100, 1)}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Max Tokens</div>
                  <div className="s-desc">{t('settings.maxTokensDesc')}</div>
                </td>
                <td>{slider('maxTokens', 0, 16384, 256)}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Frequency Penalty</div>
                  <div className="s-desc">{t('settings.freqDesc')}</div>
                </td>
                <td>{slider('frequencyPenalty', -2, 2, 0.05, (v) => v.toFixed(2))}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Presence Penalty</div>
                  <div className="s-desc">{t('settings.presDesc')}</div>
                </td>
                <td>{slider('presencePenalty', -2, 2, 0.05, (v) => v.toFixed(2))}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">Repetition Penalty</div>
                  <div className="s-desc">{t('settings.repDesc')}</div>
                </td>
                <td>{slider('repetitionPenalty', 0.5, 2, 0.05, (v) => v.toFixed(2))}</td>
              </tr>
              <tr>
                <td>
                  <div className="s-label">{t('settings.contextCompression')}</div>
                  <div className="s-desc">{t('settings.contextCompressionDesc')}</div>
                </td>
                <td>
                  <label className="range-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                    <input
                      type="range"
                      className="generation-slider"
                      min="0"
                      max="100"
                      step="1"
                      value={settings.contextCompressionThreshold === 'off' ? 0 : settings.contextCompressionThreshold}
                      onPointerDown={startGenerationSliderGesture}
                      onPointerMove={classifyGenerationSliderGesture}
                      onPointerUp={endGenerationSliderGesture}
                      onPointerCancel={endGenerationSliderGesture}
                      onChange={(e) => updateGenerationSlider('contextCompressionThreshold', Number(e.target.value) || 'off')}
                    />
                    <span className="range-val">
                      {settings.contextCompressionThreshold === 'off' ? t('settings.off') : settings.contextCompressionThreshold}
                    </span>
                  </label>
                </td>
              </tr>
              <tr>
                <td style={{ borderBottom: 'none' }}>
                  <div className="s-label">Reasoning Effort</div>
                  <div className="s-desc">{t('settings.effortDesc')}</div>
                </td>
                <td style={{ borderBottom: 'none' }}>
                  <select
                    className="select"
                    value={settings.reasoningEffort}
                    onChange={(e) => setSettings({ reasoningEffort: e.target.value as ReasoningEffort })}
                  >
                    {['auto', 'off', 'low', 'medium', 'xhigh'].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>

        <div className="settings-tab-panel" data-active={tab === 'general' ? 'true' : 'false'} role="tabpanel">
          {/* 界面语言 */}
          <div className="set-section">
            <h3>{t('settings.language')}</h3>
            <select
              className="select"
              aria-label={t('settings.languageLabel')}
              value={settings.language ?? ''}
              onChange={(e) => setSettings({ language: (e.target.value || null) as AppLanguage })}
            >
              <option value="">{t('settings.followBrowser')}</option>
              <option value="zh-CN">简体中文</option>
              <option value="zh-TW">繁體中文</option>
              <option value="en">English</option>
            </select>
          </div>

          {/* 主题 */}
          <div className="set-section">
            <h3>{t('settings.theme')}</h3>
            <div className="theme-palette-grid" role="radiogroup" aria-label={t('settings.colorPalette')}>
              {(['amber', 'jade', 'rose', 'indigo'] as ThemePaletteId[]).map((palette) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={settings.themePalette === palette}
                  className={`theme-palette-option theme-palette-${palette}${settings.themePalette === palette ? ' active' : ''}`}
                  onClick={() => setSettings({ themePalette: palette })}
                  key={palette}
                >
                  <span className="theme-palette-preview" aria-hidden="true">
                    <i /><i /><i />
                  </span>
                  <span>{t(`settings.palette.${palette}`)}</span>
                </button>
              ))}
            </div>
            <label className="theme-mode-row">
              <span>{t('settings.appearance')}</span>
              <select
                className="select"
                aria-label={t('settings.appearance')}
                value={settings.themeMode}
                onChange={(e) => setSettings({ themeMode: e.target.value as ThemeMode })}
              >
                <option value="system">{t('settings.system')}</option>
                <option value="light">{t('settings.light')}</option>
                <option value="dark">{t('settings.dark')}</option>
              </select>
            </label>
          </div>

        <div className="set-section settings-about-section">
          <div>
            <h3>{t('settings.aboutTitle')}</h3>
            <p className="settings-reset-desc">{t('settings.aboutDesc', { version: APP_VERSION })}</p>
          </div>
          <button
            className="btn settings-about-button"
            onClick={() => setShowVersionHistory(true)}
          >
            <Icon name="book" size={14} /> {t('settings.viewChangelog')}
            {hasUnseenVersion && <span className="unseen-dot" title={t('changelog.unseen')} />}
          </button>
        </div>

        <div className="set-section settings-reset-section">
          <div>
            <h3>{t('settings.resetTitle')}</h3>
            <p className="settings-reset-desc">{t('settings.resetDesc')}</p>
          </div>
          <button className="btn btn-danger settings-reset-button" onClick={() => setShowResetConfirm(true)}>
            <Icon name="refresh" size={14} /> {t('settings.resetBtn')}
          </button>
        </div>
        </div>
      </div>

      {showVersionHistory && <VersionHistoryModal onClose={() => setShowVersionHistory(false)} />}

      {showResetConfirm && (
        <Modal onClose={() => !resetting && setShowResetConfirm(false)} size="compact">
          <div className="modal-head">
            <span className="typo-dialog-title">{t('settings.resetConfirmTitle')}</span>
            <button className="icon-btn" disabled={resetting} onClick={() => setShowResetConfirm(false)}><Icon name="x" /></button>
          </div>
          <div className="modal-body">{t('settings.resetConfirm')}</div>
          <div className="modal-foot">
            <button className="btn" disabled={resetting} onClick={() => setShowResetConfirm(false)}>{t('common.cancel')}</button>
            <button
              className="btn btn-danger"
              disabled={resetting}
              onClick={async () => {
                setResetting(true);
                try {
                  await resetTavern();
                } catch {
                  setResetting(false);
                }
              }}
            >
              {resetting && <span className="spinner" style={{ width: 11, height: 11 }} />}
              <Icon name="refresh" size={13} /> {t('settings.resetBtn')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
});

// ---------------- Providers ----------------

interface ModelsResult {
  models: string[];
  viaProxy: boolean;
}

/** 依次尝试常见 models 端点，返回第一个成功的模型列表。
 *  若直连请求被 CORS 拦截，自动回退到开发服务器同源代理（若可用）。 */
async function fetchModelsSmart(baseUrl: string, apiKey: string): Promise<ModelsResult> {
  const base = baseUrl.replace(/\/+$/, '');
  const candidates = [`${base}/models`, `${base}/v1/models`];

  // 收集“网络层失败”的次数：若直连失败且存在可用的代理 URL → 自动重试代理
  const proxyUrl = toProxyUrl(baseUrl);

  let lastErr: Error | null = null;
  const tryFetch = async (url: string): Promise<string[]> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      const resp = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const json = (await resp.json()) as { data?: Array<{ id: string }> };
      const models = (json.data ?? []).map((m: { id: string }) => m.id).sort();
      if (models.length === 0) throw new Error('empty-model-list');
      return models;
    } finally {
      clearTimeout(timer);
    }
  };

  // 第 1 轮：直连
  for (const url of candidates) {
    try {
      return { models: await tryFetch(url), viaProxy: false };
    } catch (e) {
      lastErr = e as Error;
    }
  }

  // 第 2 轮：CORS/网络失败 → 代理回退
  if (proxyUrl && isNetworkLikeError(lastErr)) {
    const proxiedCandidates = [`${proxyUrl}/models`, `${proxyUrl}/v1/models`];
    for (const url of proxiedCandidates) {
      try {
        const models = await tryFetch(url);
        return { models, viaProxy: !!proxyUrl };
      } catch (e) {
        lastErr = e as Error;
      }
    }
  }

  throw lastErr ?? new Error('unknown-error');
}

function ApiKeyField({ value, onChange, required = false, openingTarget }: { value: string; onChange: (value: string) => void; required?: boolean; openingTarget?: string }) {
  const t = useT();
  const [visible, setVisible] = useState(false);

  return (
    <div className="field">
      <label>{t('settings.apiKey')}</label>
      <div className="password-input-wrap">
        <input
          data-opening-target={openingTarget}
          className="input mono"
          type={visible ? 'text' : 'password'}
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            if (openingTarget && value.trim()) window.dispatchEvent(new CustomEvent('th-opening-field-completed', { detail: openingTarget }));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && openingTarget && value.trim()) window.dispatchEvent(new CustomEvent('th-opening-field-completed', { detail: openingTarget }));
          }}
          placeholder={t('settings.apiKeyPh')}
          autoComplete="new-password"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
        />
        <button
          type="button"
          className="password-visibility-btn"
          onClick={() => setVisible((current) => !current)}
          aria-label={t(visible ? 'settings.hideApiKey' : 'settings.showApiKey')}
          title={t(visible ? 'settings.hideApiKey' : 'settings.showApiKey')}
        >
          <Icon name={visible ? 'eye-off' : 'eye'} size={16} />
        </button>
      </div>
    </div>
  );
}

function ScrollingProviderName({ name }: { name: string }) {
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
    <span ref={containerRef} className={`p-name card-name-scroll${overflowing ? ' is-overflowing' : ''}`}>
      <span ref={textRef} className="card-name-scroll-text">{name}</span>
      {overflowing && <span className="card-name-scroll-text card-name-scroll-copy" aria-hidden="true">{name}</span>}
    </span>
  );
}

function ImageProviderManager({ providers, onChanged }: { providers: ImageProvider[]; onChanged: () => void }) {
  const settings = useStore((s) => s.settings)!;
  const setSettings = useStore((s) => s.setSettings);
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [editing, setEditing] = useState<ImageProvider | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ImageProvider | null>(null);
  const providerName = (kind: ImageProviderKind) => t(`settings.imageProviderKind.${kind === 'bailian-token-plan' ? 'bailianTokenPlan' : kind}`);

  const saveProvider = async (provider: ImageProvider) => {
    if (provider.id != null) await db.imageProviders.update(provider.id, provider);
    else await db.imageProviders.add(provider);
    setEditing(null);
    await onChanged();
    addToast(t(provider.id != null ? 'toast.imageProviderUpdated' : 'toast.imageProviderAdded'));
  };

  return (
    <div className="set-section">
      <div className="settings-section-head">
        <h3>{t('settings.imageProviderTitle')}</h3>
        <button className="btn btn-sm settings-gen-reset" onClick={() => setEditing({ kind: 'bailian-token-plan', apiKey: '', isEnabled: true, createdAt: Date.now() })}>
          <Icon name="plus" size={13} /> {t('settings.addProvider')}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {providers.length === 0 && <div className="typo-body-sm text-muted">{t('settings.noImageProvider')}</div>}
        {[...providers].sort((a, b) => b.createdAt - a.createdAt).map((provider) => (
          <div key={provider.id} className={`provider-card ${provider.isEnabled ? '' : 'disabled'}`}>
            <div className="p-head">
              <label className="switch" title={provider.isEnabled ? t('settings.disable') : t('settings.enable')}>
                <input type="checkbox" checked={provider.isEnabled} onChange={async () => { await db.imageProviders.update(provider.id!, { isEnabled: !provider.isEnabled }); await onChanged(); }} />
                <span className="switch-slider" />
              </label>
              <ScrollingProviderName name={providerName(provider.kind)} />
              <span className="p-status voice">{t('settings.imageServiceTag')}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => setEditing(provider)}>{t('common.edit')}</button>
                <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(provider)}><Icon name="trash" size={12} /></button>
              </div>
            </div>
            <div className="provider-inline-detail"><b>{t('settings.models')}:</b> {IMAGE_MODELS.join(', ')}</div>
          </div>
        ))}
      </div>
      <div className="voice-default-card">
        <div>
          <div className="s-label">{t('settings.defaultImageModel')}</div>
          <div className="s-desc">{t('settings.defaultImageModelDesc')}</div>
        </div>
        <select
          className="select voice-default-select"
          value={settings.activeImageProviderId != null && settings.defaultImageModel ? `${settings.activeImageProviderId}:${settings.defaultImageModel}` : ''}
          onChange={(event) => {
            const [providerId, model] = event.target.value.split(':');
            void setSettings(event.target.value
              ? { activeImageProviderId: Number(providerId), defaultImageModel: model }
              : { activeImageProviderId: null });
          }}
        >
          <option value="">{t('settings.noDefaultImageProvider')}</option>
          {providers.filter((provider) => provider.isEnabled).flatMap((provider) => IMAGE_MODELS.map((model) => (
            <option key={`${provider.id}:${model}`} value={`${provider.id}:${model}`}>{providerName(provider.kind)} · {model}</option>
          )))}
        </select>
      </div>
      {editing && <Modal onClose={() => setEditing(null)}>
        <div className="modal-head">
          <span className="typo-dialog-title">{editing.id != null ? t('settings.editImageProvider') : t('settings.addImageProvider')}</span>
          <button className="icon-btn" onClick={() => setEditing(null)}><Icon name="x" /></button>
        </div>
        <ImageProviderForm initial={editing} onSave={saveProvider} />
      </Modal>}
      {pendingDelete && <DeleteConfirmDialog title={t('settings.deleteImageProvider')} itemName={providerName(pendingDelete.kind)} onCancel={() => setPendingDelete(null)} onConfirm={async () => {
        await db.imageProviders.delete(pendingDelete.id!);
        if (settings.activeImageProviderId === pendingDelete.id) await setSettings({ activeImageProviderId: null });
        setPendingDelete(null);
        await onChanged();
      }} />}
    </div>
  );
}

function ImageProviderForm({ initial, onSave }: { initial: ImageProvider; onSave: (provider: ImageProvider) => void }) {
  const t = useT();
  const [kind, setKind] = useState<ImageProviderKind>(initial.kind);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  return <>
    <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="field">
        <label>{t('settings.imageProvider')}</label>
        <select className="select" value={kind} disabled={initial.id != null} onChange={(event) => setKind(event.target.value as ImageProviderKind)}>
          <option value="bailian-token-plan">{t('settings.imageProviderKind.bailianTokenPlan')}</option>
        </select>
      </div>
      <ApiKeyField value={apiKey} onChange={setApiKey} required />
      <div className="field">
        <label>{t('settings.models')}</label>
        <div className="provider-inline-detail">{IMAGE_MODELS.join(', ')}</div>
      </div>
    </div>
    <div className="modal-foot">
      <button className="btn btn-primary" disabled={!apiKey.trim()} onClick={() => onSave({ ...initial, kind, apiKey: apiKey.trim(), isEnabled: true })}>{t('common.save')}</button>
    </div>
  </>;
}

function VoiceProviderManager({ providers, onChanged }: { providers: VoiceProvider[]; onChanged: () => void }) {
  const settings = useStore((s) => s.settings)!;
  const setSettings = useStore((s) => s.setSettings);
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [editing, setEditing] = useState<VoiceProvider | null>(null);
  const [pendingDelete, setPendingDelete] = useState<VoiceProvider | null>(null);

  const providerName = (kind: VoiceProviderKind) => t(`settings.voiceProviderKind.${kind}`);
  const voiceLabel = (voiceId: VoiceId) => t(`settings.voiceLabel.${voiceId}`);

  const saveProvider = async (provider: VoiceProvider) => {
    if (provider.id != null) await db.voiceProviders.update(provider.id, provider);
    else await db.voiceProviders.add(provider);
    setEditing(null);
    await onChanged();
    addToast(t(provider.id != null ? 'toast.voiceProviderUpdated' : 'toast.voiceProviderAdded'));
  };

  return (
    <div className="set-section">
      <div className="settings-section-head">
        <h3>{t('settings.voiceProviderTitle')}</h3>
        <button className="btn btn-sm settings-gen-reset" onClick={() => setEditing({ kind: 'deepseek', apiKey: '', isEnabled: true, createdAt: Date.now() })}>
          <Icon name="plus" size={13} /> {t('settings.addProvider')}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {providers.length === 0 && <div className="typo-body-sm text-muted">{t('settings.noVoiceProvider')}</div>}
        {[...providers].sort((a, b) => b.createdAt - a.createdAt).map((provider) => {
          const options = VOICE_PROVIDER_OPTIONS[provider.kind];
          return (
            <div key={provider.id} className={`provider-card ${provider.isEnabled ? '' : 'disabled'}`}>
              <div className="p-head">
                <label className="switch" title={provider.isEnabled ? t('settings.disable') : t('settings.enable')}>
                  <input type="checkbox" checked={provider.isEnabled} onChange={async () => { await db.voiceProviders.update(provider.id!, { isEnabled: !provider.isEnabled }); await onChanged(); }} />
                  <span className="switch-slider" />
                </label>
                <ScrollingProviderName name={providerName(provider.kind)} />
                <span className="p-status voice">{t('settings.voiceServiceTag')}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm" onClick={() => setEditing(provider)}>{t('common.edit')}</button>
                  <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(provider)}><Icon name="trash" size={12} /></button>
                </div>
              </div>
              <div className="provider-inline-detail"><b>{t('settings.voices')}:</b> {options.voices.map((voice) => voiceLabel(voice.id)).join(', ')}</div>
            </div>
          );
        })}
      </div>
      <div className="voice-default-card">
        <div>
          <div className="s-label">{t('settings.defaultVoice')}</div>
          <div className="s-desc">{t('settings.defaultVoiceDesc')}</div>
        </div>
        <select
          className="select voice-default-select"
          value={settings.activeVoiceProviderId != null && settings.activeVoiceId ? `${settings.activeVoiceProviderId}:${settings.activeVoiceId}` : ''}
          onChange={(event) => {
            const [providerId, voiceId] = event.target.value.split(':');
            void setSettings(event.target.value
              ? { activeVoiceProviderId: Number(providerId), activeVoiceId: voiceId as VoiceId }
              : { activeVoiceProviderId: null, activeVoiceId: null });
          }}
        >
          <option value="">{t('settings.noDefaultVoice')}</option>
          {providers.filter((provider) => provider.isEnabled).flatMap((provider) => VOICE_PROVIDER_OPTIONS[provider.kind].voices.map((voice) => (
            <option key={`${provider.id}:${voice.id}`} value={`${provider.id}:${voice.id}`}>
              {providerName(provider.kind)} · {voiceLabel(voice.id)}
            </option>
          )))}
        </select>
      </div>
      {editing && <Modal onClose={() => setEditing(null)}>
        <div className="modal-head">
          <span className="typo-dialog-title">{editing.id != null ? t('settings.editVoiceProvider') : t('settings.addVoiceProvider')}</span>
          <button className="icon-btn" onClick={() => setEditing(null)}><Icon name="x" /></button>
        </div>
        <VoiceProviderForm initial={editing} onSave={saveProvider} />
      </Modal>}
      {pendingDelete && <DeleteConfirmDialog title={t('settings.deleteVoiceProvider')} itemName={providerName(pendingDelete.kind)} onCancel={() => setPendingDelete(null)} onConfirm={async () => {
        await db.voiceProviders.delete(pendingDelete.id!);
        if (settings.activeVoiceProviderId === pendingDelete.id) await setSettings({ activeVoiceProviderId: null, activeVoiceId: null });
        setPendingDelete(null);
        await onChanged();
      }} />}
    </div>
  );
}

function VoiceProviderForm({ initial, onSave }: { initial: VoiceProvider; onSave: (provider: VoiceProvider) => void }) {
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [kind, setKind] = useState<VoiceProviderKind>(initial.kind);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<VoiceId | null>(null);
  const voices = VOICE_PROVIDER_OPTIONS[kind].voices;

  const preview = async (voiceId: VoiceId) => {
    setPreviewingVoiceId(voiceId);
    try {
      await previewVoice(kind, apiKey, voiceId, t('settings.voicePreviewText'));
      addToast(t('toast.voicePreviewPlaying'));
    } catch (error) {
      addToast(t('toast.voiceFailed', { msg: error instanceof Error ? error.message : String(error) }), 'error');
    } finally {
      setPreviewingVoiceId(null);
    }
  };

  return <>
    <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="field"><label>{t('settings.voiceProvider')}</label><select className="select" value={kind} disabled={initial.id != null} onChange={(event) => setKind(event.target.value as VoiceProviderKind)}><option value="deepseek">{t('settings.voiceProviderKind.deepseek')}</option><option value="bailian">{t('settings.voiceProviderKind.bailian')}</option></select></div>
      <ApiKeyField value={apiKey} onChange={setApiKey} required />
      <div className="field"><label>{t('settings.voices')}</label><div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{voices.map((voice) => <div key={voice.id} className="provider-voice-option"><span><b>{voice.id}</b><br /><span className="text-muted">{t(`settings.voiceLabel.${voice.id}`)}</span></span><button type="button" className="icon-btn provider-voice-preview" disabled={!apiKey.trim() || previewingVoiceId != null} title={t('settings.previewVoice')} aria-label={`${t('settings.previewVoice')}: ${t(`settings.voiceLabel.${voice.id}`)}`} onClick={() => void preview(voice.id)}>{previewingVoiceId === voice.id ? <span className="spinner" /> : <Icon name="speaker" size={17} />}</button></div>)}</div></div>
    </div>
    <div className="modal-foot">
      <button className="btn btn-primary" disabled={!apiKey.trim()} onClick={() => onSave({ ...initial, kind, apiKey: apiKey.trim(), isEnabled: true })}>{t('common.save')}</button>
    </div>
  </>;
}

function ProviderManager({ providers, onChanged }: { providers: ApiProvider[]; onChanged: () => void | Promise<void> }) {
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [editing, setEditing] = useState<ApiProvider | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ApiProvider | null>(null);
  const orderedProviders = [...providers].sort((a, b) => b.createdAt - a.createdAt);

  const toggleEnabled = async (p: ApiProvider) => {
    await db.providers.update(p.id!, { isEnabled: !p.isEnabled });
    onChanged();
    addToast(p.isEnabled ? t('toast.providerDisabled', { name: p.name }) : t('toast.providerEnabled', { name: p.name }));
  };

  const deleteProvider = async (p: ApiProvider) => {
    await db.providers.delete(p.id!);
    onChanged();
    addToast(t('toast.providerDeleted'));
  };

  return (
    <div className="set-section">
      <div className="settings-section-head">
        <h3>{t('settings.providerTitle')}</h3>
        <button
          data-opening-target="add-provider"
          className="btn btn-sm settings-gen-reset"
          onClick={() => setEditing({ name: '', baseUrl: '', apiKey: '', isEnabled: true, cachedModelsCsv: '', modelAliasesJson: '{}', createdAt: Date.now() })}
        >
          <Icon name="plus" size={13} /> {t('settings.addProvider')}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {providers.length === 0 && <div className="typo-body-sm text-muted">{t('settings.noProvider')}</div>}
        {orderedProviders.map((p) => {
          const aliases = modelAliases(p);
          const enabledModels = enabledModelIds(p);
          const visibleModels = p.cachedModelsCsv.split(',').map((model) => model.trim()).filter((model) => enabledModels.has(model));

          return (
            <div key={p.id} className={`provider-card ${p.isEnabled ? '' : 'disabled'}`}>
              <div className="p-head">
                {/* 启用开关放在卡片左侧最外面 */}
                <label className="switch" title={p.isEnabled ? t('settings.disable') : t('settings.enable')}>
                  <input type="checkbox" checked={p.isEnabled} onChange={() => toggleEnabled(p)} />
                  <span className="switch-slider" />
                </label>
                <ScrollingProviderName name={p.name} />
                <span className="p-status text">{t('settings.textServiceTag')}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm" onClick={() => setEditing(p)}>{t('common.edit')}</button>
                  <button className="btn btn-sm btn-danger" onClick={() => setPendingDelete(p)}><Icon name="trash" size={12} /></button>
                </div>
              </div>
              <div className="p-url">{p.baseUrl}</div>
              <div className="provider-inline-detail">
                <b>{t('settings.models')}</b>
                {visibleModels.length > 0
                  ? visibleModels.slice(0, 12).map((model) => aliases[model]?.trim() || model).join(', ')
                  : t('settings.emptyModels')}
                {visibleModels.length > 12 ? '…' : ''}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <div className="modal-head">
            <span className="typo-dialog-title">{editing.id != null ? t('settings.editProvider') : t('settings.addProvider')}</span>
            <button className="icon-btn" onClick={() => setEditing(null)}><Icon name="x" /></button>
          </div>
          <ProviderForm
            initial={editing}
            onSave={async (data) => {
              let savedProviderId = editing.id;
              if (editing.id != null) {
                await db.providers.update(editing.id, data);
                addToast(t('toast.providerUpdated'));
              } else {
                savedProviderId = await db.providers.add(data);
                addToast(t('toast.providerAdded'));
              }
              setEditing(null);
              await onChanged();
              window.dispatchEvent(new CustomEvent('th-opening-provider-saved', { detail: savedProviderId }));
            }}
          />
        </Modal>
      )}

      {pendingDelete && (
        <DeleteConfirmDialog
          title={t('settings.deleteProvider')}
          itemName={pendingDelete.name}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteProvider(pendingDelete)}
        />
      )}
    </div>
  );
}

function ProviderForm({ initial, onSave }: { initial: ApiProvider; onSave: (p: ApiProvider) => void }) {
  const providers = useStore((s) => s.providers);
  const addToast = useStore((s) => s.addToast);
  const t = useT();
  const [name, setName] = useState(initial.name);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [models, setModels] = useState(() => initial.cachedModelsCsv.split(',').map((model) => model.trim()).filter(Boolean));
  const [aliases, setAliases] = useState(() => modelAliases(initial));
  const [enabledModels, setEnabledModels] = useState(() => enabledModelIds(initial));
  const [testing, setTesting] = useState(false);

  const testConnection = async () => {
    if (!baseUrl.trim()) return;
    setTesting(true);
    try {
      const { models: fetchedModels, viaProxy } = await fetchModelsSmart(baseUrl.trim(), apiKey);
      const updatedAliases = Object.fromEntries(Object.entries(aliases).filter(([model]) => fetchedModels.includes(model)));
      const updatedEnabledModels = new Set(fetchedModels.filter((model) => !models.includes(model) || enabledModels.has(model)));
      setModels(fetchedModels);
      setAliases(updatedAliases);
      setEnabledModels(updatedEnabledModels);
      addToast(t('toast.providerOk', { n: fetchedModels.length, via: viaProxy ? t('toast.providerViaProxy') : '' }));
      window.dispatchEvent(new CustomEvent('th-opening-provider-tested'));
    } catch (e) {
      const msg = (e as Error).message;
      addToast(t('toast.providerFail', { msg, hint: isNetworkLikeError(e) ? t('toast.providerFailCors') : '' }), 'error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label>{t('settings.providerName')}</label>
          <input
            data-opening-target="provider-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name.trim()) window.dispatchEvent(new CustomEvent('th-opening-field-completed', { detail: 'provider-name' })); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) window.dispatchEvent(new CustomEvent('th-opening-field-completed', { detail: 'provider-name' })); }}
            placeholder={t('settings.providerNamePh')}
          />
        </div>
        <div className="field">
          <label>{t('settings.baseUrl')}</label>
          <input
            data-opening-target="provider-base-url"
            className="input mono"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={() => { if (baseUrl.trim()) window.dispatchEvent(new CustomEvent('th-opening-field-completed', { detail: 'provider-base-url' })); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && baseUrl.trim()) window.dispatchEvent(new CustomEvent('th-opening-field-completed', { detail: 'provider-base-url' })); }}
            placeholder={t('settings.baseUrlPh')}
          />
        </div>
        <ApiKeyField value={apiKey} onChange={setApiKey} openingTarget="provider-api-key" />
        {models.length > 0 && (
          <div className="field">
            <label>{t('settings.models')}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflow: 'auto' }}>
              {models.map((model) => (
                <div key={model} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 1fr)', gap: 8, alignItems: 'center' }}>
                  <label className="switch" title={enabledModels.has(model) ? t('settings.disable') : t('settings.enable')}>
                    <input
                      type="checkbox"
                      checked={enabledModels.has(model)}
                      onChange={() => setEnabledModels((current) => {
                        const next = new Set(current);
                        if (next.has(model)) next.delete(model);
                        else next.add(model);
                        return next;
                      })}
                    />
                    <span className="switch-slider" />
                  </label>
                  <span className="mono" title={model} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model}</span>
                  <input
                    className="input"
                    value={aliases[model] ?? ''}
                    onChange={(e) => setAliases((current) => ({ ...current, [model]: e.target.value }))}
                    placeholder={t('settings.modelAliasPh')}
                    aria-label={`${t('settings.modelAlias')}: ${model}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => {}} style={{ visibility: 'hidden' }}>{t('common.cancel')}</button>
        <button data-opening-target="provider-test" className="btn" disabled={!baseUrl.trim() || testing} onClick={testConnection}>
          {testing && <span className="spinner" style={{ width: 11, height: 11 }} />}
          {testing ? t('settings.testing') : t('settings.test')}
        </button>
        <button
          data-opening-target="provider-save"
          className="btn btn-primary"
          disabled={!name.trim() || !baseUrl.trim()}
          onClick={() => {
            const modelNames = models
              .filter((model) => enabledModels.has(model))
              .map((model) => (aliases[model]?.trim() || model).trim());
            const otherModelNames = new Set(
              providers
                .filter((provider) => provider.id !== initial.id)
                .flatMap((provider) => provider.cachedModelsCsv
                  .split(',')
                  .map((model) => model.trim())
                  .filter((model) => model && enabledModelIds(provider).has(model))
                  .map((model) => (modelAliases(provider)[model]?.trim() || model).trim())),
            );
            const duplicate = modelNames.find((model, index) =>
              modelNames.indexOf(model) !== index || otherModelNames.has(model),
            );
            if (duplicate) {
              addToast(t('toast.providerDuplicateModel', { model: duplicate }), 'error');
              return;
            }
            onSave({
              ...initial,
              name: name.trim(),
              baseUrl: baseUrl.trim(),
              apiKey,
              cachedModelsCsv: models.join(','),
              modelAliasesJson: JSON.stringify(Object.fromEntries(Object.entries(aliases).filter(([, alias]) => alias.trim()))),
              enabledModelIdsJson: JSON.stringify([...enabledModels]),
            });
          }}
        >
          {t('common.save')}
        </button>
      </div>
    </>
  );
}

