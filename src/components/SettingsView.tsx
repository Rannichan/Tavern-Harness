import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../store/store';
import { db, DEFAULT_GENERATION_SETTINGS } from '../db/database';
import { type ThemeMode } from '../theme/theme';
import { type ApiProvider, type AppLanguage, type AppSettings, type ReasoningEffort, enabledModelIds, modelAliases } from '../types/models';
import { Icon, Modal } from './shared';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { isNetworkLikeError } from '../core/proxy';
import { fetchModelsSmart, splitProviderModels } from '../core/providerModels';
import { useT } from '../core/i18n';
import { APP_VERSION, useHasUnseenVersion } from '../core/version';
import { VersionHistoryModal } from './VersionHistoryModal';
import { BAILIAN_TOKEN_PLAN_SPEECH_MODEL, BAILIAN_TOKEN_PLAN_SPEECH_VOICE, createBailianTokenPlanProvider, isBailianTokenPlanUrl } from '../core/bailianTokenPlan';

// ============================================================
// 设置视图（模型服务 / 超参数 / 主题）
// ============================================================

export const SettingsView = memo(function SettingsView() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const addToast = useStore((s) => s.addToast);
  const resetTavern = useStore((s) => s.resetTavern);
  const providers = useStore((s) => s.providers);
  const refreshProviders = useStore((s) => s.refreshProviders);
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
    <div className="view-page">
      <div className="view-col">
        <div>
          <h2 className="view-title">{t('settings.title')}</h2>
          <p className="view-sub">{t('settings.sub')}</p>
        </div>

        {/* 模型服务 Provider（置顶） */}
        <ProviderManager providers={providers} onChanged={refreshProviders} />
        <SpeechSettings settings={settings} providers={providers} />

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
          <div className="set-row settings-tool-row">
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
                onChange={(e) => setSettings({ nsfwMode: e.target.checked })}
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

        <div className="set-grid">
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
          </div>
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

function ProviderManager({ providers, onChanged }: { providers: ApiProvider[]; onChanged: () => void }) {
  const addToast = useStore((s) => s.addToast);
  const settings = useStore((s) => s.settings);
  const modelsList = useStore((s) => s.modelsList);
  const selectModel = useStore((s) => s.selectModel);
  const t = useT();
  const [editing, setEditing] = useState<ApiProvider | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ApiProvider | null>(null);

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
      <h3>{t('settings.providerTitle')}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {providers.length === 0 && <div className="typo-body-sm text-muted">{t('settings.noProvider')}</div>}
        {providers.map((p) => {
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
                <span className="p-name">{p.name}</span>
                <span className={`p-status ${p.isEnabled ? 'on' : 'off'}`}>{p.isEnabled ? t('settings.enable') : t('settings.disable')}</span>
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="btn" onClick={() => setEditing({ name: '', baseUrl: '', apiKey: '', isEnabled: true, cachedModelsCsv: '', modelAliasesJson: '{}', createdAt: Date.now() })}>
            <Icon name="plus" size={13} /> {t('settings.addProvider')}
          </button>
          <button className="btn" onClick={() => setEditing(createBailianTokenPlanProvider())}>
            <Icon name="plus" size={13} /> {t('settings.addTokenPlan')}
          </button>
        </div>
        {modelsList.length > 0 && (
          <div className="field">
            <label htmlFor="default-text-model">{t('settings.defaultTextModel')}</label>
            <select
              id="default-text-model"
              className="select"
              value={modelsList.some((option) => option.providerId === settings?.defaultProviderId && option.modelId === settings?.defaultModel)
                ? JSON.stringify([settings?.defaultProviderId, settings?.defaultModel]) : ''}
              onChange={(event) => {
                const selected = modelsList.find((option) => JSON.stringify([option.providerId, option.modelId]) === event.target.value);
                if (selected) void selectModel(selected);
              }}
            >
              {!modelsList.some((option) => option.providerId === settings?.defaultProviderId && option.modelId === settings?.defaultModel) && <option value="">{t('chat.chooseModel')}</option>}
              {modelsList.map((option) => <option key={`${option.providerId}:${option.modelId}`} value={JSON.stringify([option.providerId, option.modelId])}>{option.label}</option>)}
            </select>
          </div>
        )}
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
              if (editing.id != null) {
                await db.providers.update(editing.id, data);
                addToast(t('toast.providerUpdated'));
              } else {
                await db.providers.add(data);
                addToast(t('toast.providerAdded'));
              }
              setEditing(null);
              onChanged();
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

function SpeechSettings({ settings, providers }: { settings: AppSettings; providers: ApiProvider[] }) {
  const t = useT();
  const setSettings = useStore((state) => state.setSettings);
  const addToast = useStore((state) => state.addToast);
  const [enabled, setEnabled] = useState(settings.speechEnabled === true);
  const [providerId, setProviderId] = useState<number | null>(settings.speechProviderId ?? null);
  const [model, setModel] = useState(settings.speechModel ?? '');
  const [voice, setVoice] = useState(settings.speechVoice ?? '');
  const [autoPlay, setAutoPlay] = useState(settings.speechAutoPlay !== false);
  const [saving, setSaving] = useState(false);
  const availableProviders = providers.filter((provider) => provider.id != null && provider.isEnabled && provider.baseUrl.trim());
  const selectedProvider = availableProviders.find((provider) => provider.id === providerId);

  const selectProvider = (provider: ApiProvider | undefined) => {
    setProviderId(provider?.id ?? null);
    const isTokenPlan = !!provider && isBailianTokenPlanUrl(provider.baseUrl);
    const firstModel = provider?.cachedSpeechModelsCsv?.split(',').map((item) => item.trim()).find(Boolean);
    setModel(firstModel || (isTokenPlan ? BAILIAN_TOKEN_PLAN_SPEECH_MODEL : ''));
    setVoice(isTokenPlan ? BAILIAN_TOKEN_PLAN_SPEECH_VOICE : 'alloy');
  };

  useEffect(() => {
    if (providerId == null && availableProviders.length > 0) selectProvider(availableProviders[0]);
  }, [providers, providerId]);

  const modelSuggestions = (selectedProvider?.cachedSpeechModelsCsv ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const tokenPlan = !!selectedProvider && isBailianTokenPlanUrl(selectedProvider.baseUrl);
  const voiceSuggestions = tokenPlan
    ? [BAILIAN_TOKEN_PLAN_SPEECH_VOICE, 'longanlufeng']
    : ['alloy', 'nova', 'onyx'];
  const valid = !enabled || (!!selectedProvider && !!model.trim() && !!voice.trim()
    && (!tokenPlan || !!selectedProvider.apiKey.trim()));

  return (
    <div className="set-section">
      <h3>{t('settings.speechTitle')}</h3>
      <div className="set-row settings-tool-row">
        <div>
          <div className="s-label" id="speech-enabled-label">{t('settings.speechEnabled')}</div>
          <div className="s-desc" id="speech-enabled-desc">{t('settings.speechEnabledDesc')}</div>
        </div>
        <label className="switch">
          <input type="checkbox" aria-labelledby="speech-enabled-label" aria-describedby="speech-enabled-desc" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span className="switch-slider" />
        </label>
      </div>
      {availableProviders.length === 0 && <p className="s-desc">{t('settings.speechNoProvider')}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="field">
          <label htmlFor="speech-provider">{t('settings.speechProvider')}</label>
          <select id="speech-provider" className="select" value={providerId ?? ''} onChange={(event) => selectProvider(availableProviders.find((provider) => provider.id === Number(event.target.value)))}>
            <option value="">{t('settings.speechChooseProvider')}</option>
            {availableProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="speech-model">{t('settings.speechModel')}</label>
          <input id="speech-model" className="input mono" list="speech-model-suggestions" value={model} onChange={(event) => setModel(event.target.value)} placeholder={t('settings.speechModelPh')} />
          <datalist id="speech-model-suggestions">{modelSuggestions.map((item) => <option key={item} value={item} />)}</datalist>
        </div>
        <div className="field">
          <label htmlFor="speech-voice">{t('settings.speechVoice')}</label>
          <input id="speech-voice" className="input mono" list="speech-voice-suggestions" value={voice} onChange={(event) => setVoice(event.target.value)} placeholder={t('settings.speechVoicePh')} />
          <datalist id="speech-voice-suggestions">{voiceSuggestions.map((item) => <option key={item} value={item} />)}</datalist>
          {tokenPlan && <a className="typo-body-sm" href="https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list" target="_blank" rel="noreferrer">{t('settings.speechVoiceList')}</a>}
        </div>
        <div className="set-row settings-tool-row">
          <div className="s-label" id="speech-autoplay-label">{t('settings.speechAutoPlay')}</div>
          <label className="switch">
            <input type="checkbox" aria-labelledby="speech-autoplay-label" checked={autoPlay} onChange={(event) => setAutoPlay(event.target.checked)} />
            <span className="switch-slider" />
          </label>
        </div>
        <button
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          disabled={!valid || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await setSettings({ speechEnabled: enabled, speechProviderId: providerId, speechModel: model.trim(), speechVoice: voice.trim(), speechAutoPlay: autoPlay });
              addToast(t('toast.speechSettingsSaved'));
            } catch (error) {
              addToast(t('toast.speechSettingsFailed', { msg: (error as Error).message || String(error) }), 'error');
            } finally {
              setSaving(false);
            }
          }}
        >{t('common.save')}</button>
      </div>
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
  const [speechModels, setSpeechModels] = useState(() => (initial.cachedSpeechModelsCsv ?? '').split(',').map((model) => model.trim()).filter(Boolean));
  const [aliases, setAliases] = useState(() => modelAliases(initial));
  const [enabledModels, setEnabledModels] = useState(() => enabledModelIds(initial));
  const [testing, setTesting] = useState(false);
  const [newModel, setNewModel] = useState('');
  const isTokenPlan = isBailianTokenPlanUrl(baseUrl);
  const newModelId = newModel.trim();
  const canAddModel = !!newModelId && !/[,\s]/.test(newModelId);

  const addModel = () => {
    if (!canAddModel) return;
    const classified = splitProviderModels([newModelId]);
    if (classified.speech.length > 0) {
      setSpeechModels((current) => current.includes(newModelId) ? current : [...current, newModelId]);
      setNewModel('');
      return;
    }
    if (classified.text.length === 0) return;
    setModels((current) => current.includes(newModelId) ? current : [...current, newModelId]);
    setEnabledModels((current) => new Set([...current, newModelId]));
    setAliases((current) => current[newModelId] ? current : { ...current, [newModelId]: `Token Plan · ${newModelId}` });
    setNewModel('');
  };

  const testConnection = async () => {
    if (!baseUrl.trim()) return;
    setTesting(true);
    try {
      const { models: fetchedModels, viaProxy } = await fetchModelsSmart(baseUrl.trim(), isTokenPlan ? apiKey.trim() : apiKey);
      const fetched = splitProviderModels(fetchedModels);
      if (isTokenPlan) {
        // Keep explicitly configured models even when the catalogue omits them.
        setModels((current) => [...new Set([...current, ...fetched.text])]);
        setSpeechModels((current) => [...new Set([...current, ...fetched.speech])]);
        setAliases((current) => {
          const next = { ...current };
          for (const model of fetched.text) if (!Object.hasOwn(next, model)) next[model] = `Token Plan · ${model}`;
          return next;
        });
        addToast(t('toast.tokenPlanOk', { n: fetched.text.length, speech: fetched.speech.length, via: viaProxy ? t('toast.providerViaProxy') : '' }));
      } else {
        const updatedAliases = Object.fromEntries(Object.entries(aliases).filter(([model]) => fetched.text.includes(model)));
        const updatedEnabledModels = new Set(fetched.text.filter((model) => !models.includes(model) || enabledModels.has(model)));
        setModels(fetched.text);
        setSpeechModels(fetched.speech);
        setAliases(updatedAliases);
        setEnabledModels(updatedEnabledModels);
        addToast(t('toast.providerOk', { n: fetched.text.length, via: viaProxy ? t('toast.providerViaProxy') : '' }));
      }
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
        {isTokenPlan && (
          <div className="typo-body-sm text-muted">
            {t('settings.tokenPlanHint')}{' '}
            <a href="https://help.aliyun.com/zh/model-studio/token-plan-personal-quick-start" target="_blank" rel="noreferrer">{t('settings.tokenPlanGuide')}</a>
          </div>
        )}
        {speechModels.length > 0 && <div className="typo-body-sm text-muted">{t('settings.speechDiscovered', { models: speechModels.join(', ') })}</div>}
        <div className="field">
          <label>{t('settings.providerName')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.providerNamePh')} />
        </div>
        <div className="field">
          <label>{t('settings.baseUrl')}</label>
          <input className="input mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={t('settings.baseUrlPh')} />
        </div>
        <div className="field">
          <label>{t('settings.apiKey')}</label>
          <input className="input mono" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isTokenPlan ? 'sk-sp-...' : t('settings.apiKeyPh')} />
        </div>
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
        {isTokenPlan && (
          <div className="field">
            <label>{t('settings.tokenPlanAddModel')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input mono"
                style={{ minWidth: 0, flex: 1 }}
                value={newModel}
                onChange={(event) => setNewModel(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addModel(); } }}
                placeholder={t('settings.tokenPlanModelPh')}
                aria-label={t('settings.tokenPlanAddModel')}
              />
              <button className="btn" type="button" disabled={!canAddModel} onClick={addModel}>{t('settings.tokenPlanAdd')}</button>
            </div>
            <span className="typo-body-sm text-muted">{t('settings.tokenPlanModelsHint')}{' '}<a href="https://help.aliyun.com/zh/model-studio/token-plan-personal-overview" target="_blank" rel="noreferrer">{t('settings.tokenPlanModelList')}</a></span>
          </div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => {}} style={{ visibility: 'hidden' }}>{t('common.cancel')}</button>
        <button className="btn" disabled={!baseUrl.trim() || (isTokenPlan && !apiKey.trim()) || testing} onClick={testConnection}>
          {testing && <span className="spinner" style={{ width: 11, height: 11 }} />}
          {testing ? t('settings.testing') : isTokenPlan ? t('settings.fetchTokenPlanModels') : t('settings.test')}
        </button>
        <button
          className="btn btn-primary"
          disabled={!name.trim() || !baseUrl.trim() || (isTokenPlan && (!apiKey.trim() || enabledModels.size === 0))}
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
              apiKey: isTokenPlan ? apiKey.trim() : apiKey,
              cachedModelsCsv: models.join(','),
              cachedSpeechModelsCsv: speechModels.join(','),
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

