const PLUGIN_ID = 'galgame_plugin';
const RUNS_URL = '/runs';
const UI_API_BASE = `/plugin/${PLUGIN_ID}/ui-api`;
const TUTORIAL_STATUS_URL = `${UI_API_BASE}/tutorial/status`;
const TUTORIAL_PROGRESS_URL = `${UI_API_BASE}/tutorial/progress`;
// rapidocr / dxcam install URLs gone - both are bundled main-program deps
// (see pyproject.toml [dependency-groups] galgame). Textractor still uses
// runtime install. RapidOCR adds a model-download UI for non-bundled language
// packs using the same task lifecycle pattern as install tasks.
const RAPIDOCR_MODELS_DOWNLOAD_URL = `${UI_API_BASE}/rapidocr-models`;
const TEXTRACTOR_INSTALL_URL = `${UI_API_BASE}/textractor/install`;
const INSTALL_TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled']);
const INSTALL_COMPLETED_REFRESH_GRACE_SECONDS = 15;
const FLASH_AUTO_HIDE_MS = 4000;
const SETTINGS_AUTOSAVE_DELAY_MS = 700;
const PLUGIN_RUN_TIMEOUT_MS = 120000;
const PLUGIN_RUN_LIGHT_TIMEOUT_MS = 30000;
const TUTORIAL_PROGRESS_TIMEOUT_MS = 5000;
const PLUGIN_RUN_INITIAL_POLL_MS = 250;
const PLUGIN_RUN_MAX_POLL_MS = 2000;
const CL_ZOOM_KEY = 'galgame_current_line_zoom';
const CL_COLLAPSED_KEY = 'galgame_current_line_collapsed';
const CL_ZOOM_MIN = 12;
const CL_ZOOM_MAX = 36;
const CL_ZOOM_STEP = 2;
const CL_ZOOM_DEFAULT = 18;
const CL_COLLAPSED_DEFAULT = false;
const PIPELINE_ZOOM_KEY = 'galgame_pipeline_zoom';
const PIPELINE_ZOOM_MIN = 10;
const PIPELINE_ZOOM_MAX = 20;
const PIPELINE_ZOOM_STEP = 1;
const PIPELINE_ZOOM_DEFAULT = 13;
const PIPELINE_COLLAPSED_KEY = 'galgame_pipeline_collapsed';
const OCR_WINDOW_COLLAPSED_KEY = 'galgame_ocr_window_collapsed';
const PLUGIN_WINDOW_COLLAPSED_KEY = 'galgame_plugin_window_collapsed';
const PLUGIN_SETTINGS_COLLAPSED_KEY = 'galgame_plugin_settings_collapsed';

function uiT(key, fallback) {
  return window.I18n && typeof window.I18n.t === 'function'
    ? window.I18n.t(key, fallback)
    : (fallback || key);
}

function uiTf(key, fallback, values = {}) {
  const template = uiT(key, fallback);
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  ));
}

function uiDynamicT(prefix, key, fallback) {
  const normalized = String(key || '').trim();
  if (!normalized) {
    return fallback || '';
  }
  return uiT(`${prefix}.${normalized}`, fallback || normalized);
}

function storageGet(key, fallback = '') {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch (error) {
    console.warn('[galgame_plugin ui] localStorage read failed', error);
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn('[galgame_plugin ui] localStorage write failed', error);
    return false;
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn('[galgame_plugin ui] localStorage remove failed', error);
    return false;
  }
}

function readSkipOnboarding() {
  return storageGet('galgame_skip_onboarding') === '1';
}

function persistSkipOnboarding() {
  storageSet('galgame_skip_onboarding', '1');
}

function clearSkipOnboarding() {
  storageRemove('galgame_skip_onboarding');
}

function getInstallUIConfig() {
  return {
    textractor: {
      kind: 'textractor',
      label: 'Textractor',
      url: TEXTRACTOR_INSTALL_URL,
      storageKey: `${PLUGIN_ID}:textractor_install_task_id`,
      domPrefix: 'textractor',
      actionText: uiT('ui.install.textractor.action', 'Установить Textractor'),
      retryText: uiT('ui.install.textractor.retry', 'Повторить установку Textractor'),
      runningText: uiT('ui.install.running', 'Установка в фоне...'),
      queuedFlash: uiT('ui.install.textractor.queued', 'Фоновая задача установки создана. Textractor будет загружен по HTTPS, прогресс придет через SSE.'),
      successFlash: uiT('ui.install.textractor.success', 'Textractor установлен'),
      failureFlash: uiT('ui.install.textractor.failure', 'Не удалось установить Textractor'),
    },
    rapidocr_models: {
      kind: 'rapidocr_models',
      label: 'RapidOCR Models',
      url: RAPIDOCR_MODELS_DOWNLOAD_URL,
      storageKey: `${PLUGIN_ID}:rapidocr_models_task_id`,
      // domPrefix reuses the existing rapidocrInstallCard inside
      // rapidocrCard — that card was orphaned after PR #1191 stripped the
      // rapidocr runtime install machinery. We bring it back to surface
      // model-download progress (different operation, same UI shape).
      // buttonId is required because the card's progress button
      // (`rapidocrInstallBtn`) was removed alongside the install flow; the
      // visible CTA is `rapidocrModelsDownloadBtn` next to "使用 RapidOCR".
      // Without this override, getInstallNodes('rapidocr_models').button is
      // null and startInstall() crashes on `button.disabled = true` before
      // sending the POST.
      domPrefix: 'rapidocr',
      buttonId: 'rapidocrModelsDownloadBtn',
      actionText: uiT('ui.install.rapidocr.download_models.action', 'Скачать модели сейчас'),
      retryText: uiT('ui.install.rapidocr.download_models.retry', 'Повторить скачивание моделей'),
      runningText: uiT('ui.install.rapidocr.download_models.running', 'Скачивание моделей в фоне...'),
      queuedFlash: uiT('ui.install.rapidocr.download_models.queued', 'Создана задача скачивания моделей. Файлы будут загружаться из ModelScope, прогресс — через SSE.'),
      successFlash: uiT('ui.install.rapidocr.download_models.success', 'Модели RapidOCR скачаны'),
      failureFlash: uiT('ui.install.rapidocr.download_models.failure', 'Не удалось скачать модели RapidOCR'),
    },
  };
}

function createInstallRuntimeState() {
  return {
    state: null,
    inProgress: false,
    currentTaskId: '',
    eventSource: null,
    reconnectTimer: null,
    handledTerminalKey: '',
    generation: 0,
  };
}

const installRuntime = {
  dxcam: createInstallRuntimeState(),
  textractor: createInstallRuntimeState(),
  rapidocr_models: createInstallRuntimeState(),
};
let rapidOcrLangRequestPending = false;
let rapidOcrLangQueuedPayload = null;

function readCurrentLineZoom() {
  const raw = parseInt(storageGet(CL_ZOOM_KEY), 10);
  return Number.isFinite(raw) ? raw : CL_ZOOM_DEFAULT;
}

function readCurrentLineCollapsed() {
  const raw = storageGet(CL_COLLAPSED_KEY);
  if (raw === '1') { return true; }
  if (raw === '0') { return false; }
  return CL_COLLAPSED_DEFAULT;
}

function applyCurrentLineZoom(px) {
  const clamped = Math.max(CL_ZOOM_MIN, Math.min(CL_ZOOM_MAX, px));
  document.documentElement.style.setProperty('--galgame-line-font-size', `${clamped}px`);
  storageSet(CL_ZOOM_KEY, String(clamped));
  return clamped;
}

function readPipelineZoom() {
  const raw = parseInt(storageGet(PIPELINE_ZOOM_KEY), 10);
  return Number.isFinite(raw) ? raw : PIPELINE_ZOOM_DEFAULT;
}

function applyPipelineZoom(px) {
  const clamped = Math.max(PIPELINE_ZOOM_MIN, Math.min(PIPELINE_ZOOM_MAX, px));
  document.documentElement.style.setProperty('--ocr-pipeline-font-size', `${clamped}px`);
  storageSet(PIPELINE_ZOOM_KEY, String(clamped));
  return clamped;
}

function readPipelineCollapsed() {
  return storageGet(PIPELINE_COLLAPSED_KEY) === '1';
}

function applyPipelineCollapsed(on) {
  const collapsed = Boolean(on);
  const panel = document.getElementById('ocrPipelinePanel');
  const steps = document.getElementById('ocrPipelineSteps');
  if (panel) {
    panel.classList.toggle('collapsed', collapsed);
  }
  if (steps) {
    steps.hidden = collapsed;
    steps.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
  }
  const button = document.getElementById('ocrPipelineCollapseToggle');
  if (button) {
    button.textContent = collapsed
      ? uiT('ui.button.expand', 'Развернуть')
      : uiT('ui.button.collapse', 'Скрыть');
    button.title = collapsed
      ? uiT('ui.ocr.pipeline.expand_title', 'Развернуть шаги OCR-цепочки')
      : uiT('ui.ocr.pipeline.collapse_title', 'Скрыть шаги OCR-цепочки');
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  storageSet(PIPELINE_COLLAPSED_KEY, collapsed ? '1' : '0');
}

function applyCurrentLineCollapsed(on) {
  const collapsed = Boolean(on);
  const node = document.getElementById('currentLineOverview');
  if (node) {
    node.classList.toggle('collapsed', collapsed);
  }
  ['currentLineOverviewHint', 'currentLineEffectiveText', 'observedLinesCollapse', 'currentLineOverviewGrid'].forEach((id) => {
    const contentNode = document.getElementById(id);
    if (contentNode) {
      contentNode.classList.toggle('current-line-collapsed-hidden', collapsed);
      contentNode.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    }
  });
  const button = document.getElementById('currentLineCollapseToggle');
  if (button) {
    button.textContent = collapsed
      ? uiT('ui.button.expand', 'Развернуть')
      : uiT('ui.button.collapse', 'Скрыть');
    button.title = collapsed
      ? uiT('ui.current_line.expand_title', 'Развернуть текущую реплику')
      : uiT('ui.current_line.collapse_title', 'Скрыть текущую реплику');
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  storageSet(CL_COLLAPSED_KEY, collapsed ? '1' : '0');
}

function initCurrentLineUiPrefs() {
  applyCurrentLineZoom(readCurrentLineZoom());
  applyCurrentLineCollapsed(readCurrentLineCollapsed());

  document.getElementById('currentLineZoomIn')?.addEventListener('click', () => {
    applyCurrentLineZoom(readCurrentLineZoom() + CL_ZOOM_STEP);
  });
  document.getElementById('currentLineZoomOut')?.addEventListener('click', () => {
    applyCurrentLineZoom(readCurrentLineZoom() - CL_ZOOM_STEP);
  });
  document.getElementById('currentLineZoomReset')?.addEventListener('click', () => {
    applyCurrentLineZoom(CL_ZOOM_DEFAULT);
  });
  document.getElementById('currentLineCollapseToggle')?.addEventListener('click', () => {
    applyCurrentLineCollapsed(!readCurrentLineCollapsed());
  });
}

function initPipelineZoom() {
  applyPipelineZoom(readPipelineZoom());

  document.getElementById('ocrPipelineZoomIn')?.addEventListener('click', () => {
    applyPipelineZoom(readPipelineZoom() + PIPELINE_ZOOM_STEP);
  });
  document.getElementById('ocrPipelineZoomOut')?.addEventListener('click', () => {
    applyPipelineZoom(readPipelineZoom() - PIPELINE_ZOOM_STEP);
  });
  document.getElementById('ocrPipelineZoomReset')?.addEventListener('click', () => {
    applyPipelineZoom(PIPELINE_ZOOM_DEFAULT);
  });
}

function initPipelineCollapse() {
  applyPipelineCollapsed(readPipelineCollapsed());

  document.getElementById('ocrPipelineCollapseToggle')?.addEventListener('click', () => {
    applyPipelineCollapsed(!readPipelineCollapsed());
  });
}

function readOcrWindowCollapsed() {
  return storageGet(OCR_WINDOW_COLLAPSED_KEY) === '1';
}

function applyOcrWindowCollapsed(on) {
  const collapsed = Boolean(on);
  const panel = document.getElementById('ocrWindowPanel');
  if (panel) {
    panel.classList.toggle('collapsed', collapsed);
  }

  document.querySelectorAll('#ocrWindowPanel .ocr-window-collapsible').forEach((node) => {
    node.hidden = collapsed;
    node.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
  });

  const button = document.getElementById('ocrWindowCollapseToggle');
  if (button) {
    button.textContent = collapsed
      ? uiT('ui.button.expand', 'Развернуть')
      : uiT('ui.button.collapse', 'Скрыть');
    button.title = collapsed
      ? uiT('ui.ocr.window.expand_title', 'Развернуть выбор окна')
      : uiT('ui.ocr.window.collapse_title', 'Скрыть выбор окна');
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  storageSet(OCR_WINDOW_COLLAPSED_KEY, collapsed ? '1' : '0');
}

function initOcrWindowCollapse() {
  applyOcrWindowCollapsed(readOcrWindowCollapsed());

  document.getElementById('ocrWindowCollapseToggle')?.addEventListener('click', () => {
    applyOcrWindowCollapsed(!readOcrWindowCollapsed());
  });
}

function readPluginWindowCollapsed() {
  return storageGet(PLUGIN_WINDOW_COLLAPSED_KEY) === '1';
}

function applyPluginWindowCollapsed(on) {
  const collapsed = Boolean(on);
  const hub = document.getElementById('pluginWindowHub');
  const body = document.getElementById('pluginWindowHubBody');
  if (hub) {
    hub.classList.toggle('collapsed', collapsed);
  }
  if (body) {
    body.hidden = collapsed;
    body.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
  }

  const button = document.getElementById('pluginWindowCollapseToggle');
  if (button) {
    button.textContent = collapsed
      ? uiT('ui.button.expand', 'Развернуть')
      : uiT('ui.button.collapse', 'Скрыть');
    button.title = collapsed
      ? uiT('ui.plugin_window.expand_title', 'Развернуть окно плагина')
      : uiT('ui.plugin_window.collapse_title', 'Свернуть окно плагина');
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  storageSet(PLUGIN_WINDOW_COLLAPSED_KEY, collapsed ? '1' : '0');
}

function initPluginWindowCollapse() {
  applyPluginWindowCollapsed(readPluginWindowCollapsed());

  document.getElementById('pluginWindowCollapseToggle')?.addEventListener('click', () => {
    applyPluginWindowCollapsed(!readPluginWindowCollapsed());
  });
}

function readPluginSettingsCollapsed() {
  return storageGet(PLUGIN_SETTINGS_COLLAPSED_KEY) === '1';
}

function activePluginSettingsTabName() {
  const panel = document.getElementById('pluginSettingsPanel');
  const activeTab = panel?.querySelector('[data-settings-tab].active');
  return activeTab ? activeTab.getAttribute('data-settings-tab') || 'recognition' : 'recognition';
}

function applyPluginSettingsCollapsed(on) {
  const collapsed = Boolean(on);
  const panel = document.getElementById('pluginSettingsPanel');
  const body = document.getElementById('pluginSettingsBody');
  const tabs = document.getElementById('pluginSettingsTabs');
  const activeName = activePluginSettingsTabName();
  if (panel) {
    panel.classList.toggle('collapsed', collapsed);
  }
  if (body) {
    body.hidden = collapsed;
    body.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
  }
  if (tabs) {
    tabs.hidden = collapsed;
    tabs.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
  }
  if (collapsed) {
    const tabPanels = panel?.querySelectorAll('[data-settings-tab-panel]') || [];
    tabPanels.forEach((tabPanel) => {
      tabPanel.hidden = true;
      tabPanel.setAttribute('aria-hidden', 'true');
    });
  } else {
    setPluginSettingsTab(activeName);
  }

  const button = document.getElementById('pluginSettingsCollapseToggle');
  if (button) {
    button.textContent = collapsed
      ? uiT('ui.button.expand', 'Развернуть')
      : uiT('ui.button.collapse', 'Скрыть');
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  storageSet(PLUGIN_SETTINGS_COLLAPSED_KEY, collapsed ? '1' : '0');
}

function initPluginSettingsCollapse() {
  applyPluginSettingsCollapsed(readPluginSettingsCollapsed());

  document.getElementById('pluginSettingsCollapseToggle')?.addEventListener('click', () => {
    applyPluginSettingsCollapsed(!readPluginSettingsCollapsed());
  });
}

const DEFAULT_CAPTURE_PROFILE = {
  left_inset_ratio: 0.05,
  right_inset_ratio: 0.05,
  top_ratio: 0.62,
  bottom_inset_ratio: 0.08,
};
const AIHONG_PROCESS_NAMES = new Set(['thelamentinggeese.exe']);
const SENREN_BANKA_PROCESS_NAMES = new Set(['senrenbanka.exe', 'senrenbanka']);
const OCR_PROFILE_STAGE_LABELS_ZH = {
  default: 'Общая область',
  dialogue_stage: 'Область диалога',
  menu_stage: 'Область меню',
  title_stage: 'Заголовок/главное меню',
  save_load_stage: 'Сохранение/загрузка',
  config_stage: 'Настройки',
  transition_stage: 'Переход',
  gallery_stage: 'Галерея',
  minigame_stage: 'Мини-игра',
  game_over_stage: 'Game Over',
};
const OCR_PROFILE_STAGE_I18N_KEYS = {
  default: 'ui.stage.default',
  dialogue_stage: 'ui.stage.dialogue',
  menu_stage: 'ui.stage.menu',
  title_stage: 'ui.stage.title',
  save_load_stage: 'ui.stage.save_load',
  config_stage: 'ui.stage.config',
  transition_stage: 'ui.stage.transition',
  gallery_stage: 'ui.stage.gallery',
  minigame_stage: 'ui.stage.minigame',
  game_over_stage: 'ui.stage.game_over',
};
const OCR_CAPTURE_SAVE_SCOPE_LABELS_ZH = {
  window_bucket: 'Текущее разрешение окна',
  process_fallback: 'Общий резерв для процесса',
};
const OCR_CAPTURE_SAVE_SCOPE_I18N_KEYS = {
  window_bucket: 'ui.capture_profile.save_scope.window_bucket',
  process_fallback: 'ui.capture_profile.save_scope.process_fallback',
};
const OCR_CAPTURE_MATCH_SOURCE_LABELS_ZH = {
  bucket_exact: 'Точное совпадение текущего окна',
  bucket_aspect_nearest: 'Резерв по ближайшему соотношению сторон',
  process_fallback: 'Резерв процесса',
  builtin_preset: 'Встроенный пресет',
  config_default: 'Конфигурация плагина по умолчанию',
};
const OCR_CAPTURE_MATCH_SOURCE_I18N_KEYS = {
  bucket_exact: 'ui.capture_profile.match_source.bucket_exact',
  bucket_aspect_nearest: 'ui.capture_profile.match_source.bucket_aspect_nearest',
  process_fallback: 'ui.capture_profile.match_source.process_fallback',
  builtin_preset: 'ui.capture_profile.match_source.builtin_preset',
  config_default: 'ui.capture_profile.match_source.config_default',
};
const AIHONG_CAPTURE_PRESETS = {
  dialogue_stage: {
    left_inset_ratio: 0.05,
    right_inset_ratio: 0.24,
    top_ratio: 0.73,
    bottom_inset_ratio: 0.10,
  },
  menu_stage: {
    left_inset_ratio: 0.20,
    right_inset_ratio: 0.20,
    top_ratio: 0.40,
    bottom_inset_ratio: 0.34,
  },
};

const SENREN_BANKA_CAPTURE_PRESETS = {
  dialogue_stage: {
    left_inset_ratio: 0.25,
    right_inset_ratio: 0.05,
    top_ratio: 0.62,
    bottom_inset_ratio: 0.08,
  },
};
const OCR_GAME_CAPTURE_PRESETS = {
  senren_banka: {
    process_name: 'SenrenBanka.exe',
    default_stage: 'dialogue_stage',
    profiles: SENREN_BANKA_CAPTURE_PRESETS,
  },
};
const AUTO_REFRESH_IDLE_INTERVAL_MS = 5000;
const AUTO_REFRESH_ACTIVE_INTERVAL_MS = 1000;
const AUTO_REFRESH_URGENT_INTERVAL_MS = 500;
const AUTO_REFRESH_INTERVAL_MS = AUTO_REFRESH_ACTIVE_INTERVAL_MS;
const FOCUS_PAUSE_REFRESH_INTERVAL_MS = 1000;
const ERROR_REFRESH_INTERVAL_MS = 10000;
const OCR_WINDOW_REFRESH_TTL_MS = 3000;
const MEMORY_PROCESS_REFRESH_TTL_MS = 3000;
const CHARACTER_PROFILE_REFRESH_TTL_MS = 3000;
const FIELD_LABELS_ZH = {
  connection_state: 'Состояние подключения',
  active_data_source: 'Активный источник данных',
  reader_mode: 'Режим чтения текста',
  mode: 'Режим',
  push_notifications: 'Push-уведомления',
  advance_speed: 'Скорость продвижения',
  bound_game_id: 'Привязанный ID игры',
  active_session_id: 'Текущий ID сессии',
  last_seq: 'Последний номер',
  stream_reset_pending: 'Ожидание сброса потока',
  available_game_ids: 'Доступные ID игр',
  performance_cpu_percent: 'CPU плагина',
  performance_memory_mb: 'Память плагина',
  performance_memory_percent: 'Доля памяти плагина',
  performance_thread_count: 'Потоки плагина',
  performance_process: 'Процесс плагина',
  performance_detail: 'Статус метрик производительности',
  ocr_reader_enabled: 'OCR Reader включен',
  ocr_reader_status: 'Статус OCR Reader',
  ocr_reader_detail: 'Детали OCR Reader',
  ocr_reader_target: 'Цель OCR Reader',
  ocr_poll_interval_seconds: 'Интервал OCR',
  ocr_trigger_mode: 'Режим запуска OCR',
  ocr_trigger_mode_effective: 'Фактический запуск OCR',
  ocr_reader_fast_loop_enabled: 'OCR Fast Loop включен',
  ocr_fast_loop_running: 'OCR Fast Loop выполняется',
  ocr_fast_loop_inflight_seconds: 'OCR Fast Loop текущая длительность',
  ocr_fast_loop_last_duration_seconds: 'OCR Fast Loop последняя длительность',
  ocr_fast_loop_iteration_count: 'Итерации OCR Fast Loop',
  ocr_poll_latency_sample_count: 'Сэмплы OCR poll',
  ocr_poll_duration_p50_seconds: 'OCR poll P50',
  ocr_poll_duration_p95_seconds: 'OCR poll P95',
  bridge_poll_latency_sample_count: 'Сэмплы Bridge poll',
  bridge_poll_duration_p50_seconds: 'Bridge poll P50',
  bridge_poll_duration_p95_seconds: 'Bridge poll P95',
  ocr_auto_degrade_reason: 'Причина автопонижения OCR',
  ocr_auto_degrade_at: 'Время автопонижения OCR',
  ocr_auto_degrade_count: 'Число автопонижений OCR',
  candidate_age_seconds: 'Ожидание кандидата реплики',
  stable_confirm_wait_seconds: 'Ожидание стабильного подтверждения',
  ocr_reader_allowed: 'OCR Reader разрешен',
  ocr_reader_allowed_block_reason: 'Причина блокировки OCR Reader',
  target_window_visible: 'Целевое окно видно',
  target_window_minimized: 'Целевое окно свернуто',
  ocr_window_capture_eligible: 'Окно OCR пригодно для захвата',
  ocr_window_capture_available: 'Захват окна OCR доступен',
  ocr_window_capture_block_reason: 'Причина блокировки захвата OCR-окна',
  input_target_foreground: 'Цель ввода на переднем плане',
  input_target_block_reason: 'Причина блокировки цели ввода',
  ocr_reader_manager_available: 'Менеджер OCR Reader доступен',
  ocr_runtime_status: 'Статус OCR Runtime',
  ocr_tick_allowed: 'OCR Tick разрешен',
  ocr_tick_gate_allowed: 'Шлюз OCR Tick',
  ocr_tick_skipped_reason: 'Причина пропуска OCR Tick',
  ocr_tick_entered: 'OCR Tick вошел',
  ocr_tick_lock_acquired: 'Блокировка OCR Tick получена',
  ocr_tick_block_reason: 'Причина блокировки OCR Tick',
  ocr_emit_block_reason: 'Причина блокировки записи OCR',
  ocr_fast_loop_delegated: 'OCR Fast Loop делегирован',
  ocr_waiting_for_advance: 'OCR ждет продвижения игры',
  ocr_waiting_for_advance_reason: 'Причина ожидания продвижения',
  pending_ocr_advance_capture: 'Ожидает захвата после продвижения',
  pending_manual_foreground_ocr_capture: 'Ожидает захвата переднего плана',
  pending_ocr_delay_remaining: 'Остаток задержки захвата',
  pending_ocr_advance_capture_age_seconds: 'Время ожидания захвата',
  pending_ocr_advance_reason: 'Источник захвата после продвижения',
  pending_ocr_advance_clear_reason: 'Причина очистки захвата после продвижения',
  ocr_bootstrap_capture_needed: 'Нужен стартовый захват OCR',
  after_advance_screen_refresh_tick_needed: 'Нужно обновление экрана после продвижения',
  companion_after_advance_ocr_refresh_tick_needed: 'Нужно OCR-обновление после продвижения в режиме сопровождения',
  foreground_refresh_attempted: 'Передний план обновлен',
  foreground_refresh_skipped_reason: 'Причина пропуска обновления',
  ocr_last_tick_decision_at: 'Последнее решение OCR Tick',
  display_source_not_ocr_reason: 'Причина отображения не из OCR',
  ocr_backend_selection: 'Выбор OCR-бэкенда',
  ocr_capture_backend_selection: 'Выбор бэкенда захвата',
  ocr_background_state: 'Фоновое состояние OCR',
  ocr_background_message: 'Фоновое сообщение OCR',
  ocr_background_polling: 'Фоновый опрос OCR',
  ocr_foreground_resume_pending: 'OCR ожидает возврата на передний план',
  ocr_capture_backend_blocked: 'Бэкенд захвата OCR заблокирован',
  ocr_screen_awareness_latency_mode: 'Режим задержки распознавания экрана',
  ocr_screen_awareness_min_interval_seconds: 'Минимальный интервал распознавания экрана',
  ocr_backend_kind: 'Тип OCR-бэкенда',
  ocr_backend_detail: 'Детали OCR-бэкенда',
  rapidocr_enabled: 'RapidOCR включен',
  rapidocr_installed: 'RapidOCR установлен',
  rapidocr_detail: 'Детали RapidOCR',
  dxcam_installed: 'DXcam установлен',
  dxcam_detail: 'Детали DXcam',
  memory_reader_enabled: 'Memory Reader включен',
  memory_reader_status: 'Статус Memory Reader',
  memory_reader_detail: 'Детали Memory Reader',
  memory_reader_process: 'Процесс Memory Reader',
  textractor_installed: 'Textractor установлен',
  textractor_detail: 'Детали Textractor',
  last_error: 'Последняя ошибка',
  status: 'Статус',
  detail: 'Детали',
  process_name: 'Имя процесса',
  pid: 'ID процесса',
  window_title: 'Заголовок окна',
  width: 'Ширина окна',
  height: 'Высота окна',
  aspect_ratio: 'Соотношение сторон окна',
  game_id: 'ID игры',
  session_id: 'ID сессии',
  last_event_ts: 'Время последнего события',
  last_text_seq: 'Последний номер текста Memory',
  last_text_ts: 'Время последнего текста Memory',
  last_text_recent: 'Недавний текст Memory действителен',
  last_text_age_seconds: 'Секунды простоя текста Memory',
  capture_stage: 'Стадия захвата',
  capture_profile: 'Профиль захвата',
  capture_profile_match_source: 'Источник профиля захвата',
  capture_profile_bucket_key: 'Бакет профиля захвата',
  capture_backend_kind: 'Бэкенд захвата',
  capture_backend_detail: 'Детали бэкенда захвата',
  last_capture_image_hash: 'Последний Hash захвата',
  consecutive_same_capture_frames: 'Подряд одинаковых захватов',
  stale_capture_backend: 'Источник захвата не обновляется',
  last_rejected_ocr_text: 'Последний отклоненный OCR-текст',
  last_rejected_ocr_reason: 'Последняя причина отклонения',
  last_rejected_ocr_at: 'Время последнего отклонения',
  last_rejected_capture_backend: 'Отклоненный бэкенд захвата',
  screen_awareness_last_skip_reason: 'Причина пропуска распознавания экрана',
  screen_awareness_last_region_count: 'Число областей распознавания экрана',
  screen_awareness_last_capture_duration_seconds: 'Длительность захвата распознавания экрана',
  screen_awareness_last_ocr_duration_seconds: 'Длительность OCR распознавания экрана',
  backend_kind: 'Тип бэкенда',
  backend_detail: 'Детали бэкенда',
  backend_path: 'Путь бэкенда',
  backend_model: 'Модель бэкенда',
  languages: 'Языки',
  takeover_reason: 'Причина перехвата',
  target_selection_mode: 'Режим выбора цели',
  target_selection_detail: 'Детали выбора цели',
  effective_window_key: 'Активный ключ окна',
  effective_window_title: 'Активный заголовок окна',
  effective_process_name: 'Активное имя процесса',
  foreground_refresh_at: 'Время обновления переднего плана',
  foreground_refresh_detail: 'Детали обновления переднего плана',
  foreground_hwnd: 'Текущий hwnd переднего плана',
  target_hwnd: 'Целевой hwnd',
  last_poll_started_at: 'Последний OCR poll начат',
  last_poll_completed_at: 'Последний OCR poll завершен',
  last_poll_duration_seconds: 'Длительность последнего OCR poll',
  last_poll_emitted_event: 'Последний OCR poll создал событие',
  last_tick_skipped: 'Последний tick пропущен',
  last_tick_skip_reason: 'Причина пропуска tick',
  pending_visual_scene_count: 'Ожидающие изменения визуальной сцены',
  last_auto_recalibrate_attempts: 'Попытки автокалибровки OCR',
  last_auto_recalibrate_duration_seconds: 'Длительность автокалибровки',
  last_auto_recalibrate_limited: 'Автокалибровка ограничена',
  last_auto_recalibrate_error: 'Ошибка автокалибровки',
  last_capture_total_duration_seconds: 'Последняя общая длительность OCR',
  last_capture_frame_duration_seconds: 'Длительность захвата',
  last_capture_background_duration_seconds: 'Длительность фонового Hash',
  last_capture_image_hash_duration_seconds: 'Длительность Hash захвата',
  last_ocr_extract_duration_seconds: 'Длительность OCR-инференса',
  last_backend_plan_duration_seconds: 'Длительность выбора бэкенда',
  last_window_scan_duration_seconds: 'Длительность сканирования окон',
  last_capture_background_hash_skipped: 'Фоновый Hash пропущен',
  candidate_count: 'Число окон-кандидатов',
  excluded_candidate_count: 'Число исключенных окон',
  last_exclude_reason: 'Последняя причина исключения',
  speaker: 'Говорящий',
  text: 'Текст',
  scene_id: 'ID сцены',
  line_id: 'ID реплики',
  route_id: 'ID маршрута',
  is_menu_open: 'Меню открыто',
  snapshot_ts: 'Время снимка',
  stale: 'Устарело',
  result: 'Результат',
  agent_user_status: 'Пользовательский статус Agent',
  agent_pause_kind: 'Тип паузы Agent',
  agent_pause_message: 'Сообщение паузы Agent',
  agent_can_resume_by_button: 'Можно возобновить кнопкой',
  agent_can_resume_by_focus: 'Можно возобновить фокусом',
  inbound_queue_size: 'Входная очередь',
  outbound_queue_size: 'Исходящая очередь',
  last_interruption: 'Последнее прерывание',
  last_outbound_message: 'Последнее исходящее сообщение',
  recent_pushes: 'Недавние push-события',
  activity: 'Активность',
  reason: 'Причина',
  input_source: 'Источник ввода',
  scene_stage: 'Стадия сцены',
  push_policy: 'Политика push',
  actionable: 'Доступно действие',
  standby_requested: 'Запрошен режим ожидания',
  memory_counts: 'Счетчики памяти',

  agent_activity: 'Активность Agent',
  agent_diagnostic: 'Диагностика Agent',
  agent_reason: 'Причина Agent',
  agent_status: 'Статус Agent',
  bridge_tick_auto_running: 'Bridge tick авто-режим активен',
  bridge_tick_last_error: 'Последняя ошибка Bridge tick',
  capture_profile_auto_apply_enabled: 'Автоприменение профиля включено',
  capture_profile_last_rollback_reason: 'Причина последнего отката профиля',
  capture_profile_pending_rollback: 'Ожидающий откат профиля',
  character_fixed_name: 'Зафиксированное имя персонажа',
  character_mode: 'Режим персонажа',
  character_profile_count: 'Число профилей персонажей',
  consecutive_no_text_polls: 'Подряд опросов без текста',
  diagnostic: 'Диагностика',
  foreground_advance_consumed_seq: 'Принятый seq foreground-прокрутки',
  foreground_advance_last_delta: 'Последний дельта foreground-прокрутки',
  foreground_advance_last_kind: 'Последний тип foreground-прокрутки',
  foreground_advance_last_match_reason: 'Причина последнего совпадения прокрутки',
  foreground_advance_last_matched: 'Последнее совпадение прокрутки',
  foreground_advance_last_seq: 'Последний seq foreground-прокрутки',
  foreground_advance_monitor_running: 'Монитор foreground-прокрутки активен',
  last_agent_tick_age_seconds: 'Возраст последнего тика Agent, с',
  last_capture_attempt_at: 'Время последней попытки снимка',
  last_capture_completed_at: 'Время завершения последнего снимка',
  last_capture_error: 'Последняя ошибка снимка',
  last_capture_profile: 'Последний профиль снимка',
  last_capture_stage: 'Последняя стадия снимка',
  last_delivered_summary_key: 'Ключ последней отправленной сводки',
  last_delivered_summary_scene_id: 'Сцена последней сводки',
  last_delivered_summary_seq: 'seq последней сводки',
  last_observed_at: 'Время последнего наблюдения',
  last_observed_line: 'Последняя наблюдаемая реплика',
  last_ocr_advance_capture_reason: 'Причина последнего сбора прокрутки',
  last_raw_ocr_text: 'Последний сырой OCR-текст',
  last_session_transition_fields: 'Поля последнего перехода сессии',
  last_session_transition_reason: 'Причина последнего перехода сессии',
  last_session_transition_type: 'Тип последнего перехода сессии',
  last_stable_line: 'Последняя стабильная реплика',
  llm_vision_enabled: 'Vision-режим LLM включен',
  llm_vision_max_image_px: 'Макс. размер изображения Vision, px',
  memory_reader_detection_reason: 'Причина определения Memory Reader',
  memory_reader_hook_code_count: 'Число хук-кодов Memory Reader',
  memory_reader_hook_code_detail: 'Детали хук-кодов Memory Reader',
  memory_reader_target_selection_detail: 'Детали выбора цели Memory Reader',
  ocr_capture_diagnostic: 'Диагностика OCR-снимка',
  ocr_capture_diagnostic_required: 'Требуется диагностика OCR-снимка',
  ocr_screen_awareness_full_frame_ocr: 'Полнокадровый OCR',
  ocr_screen_awareness_multi_region_ocr: 'Многорегионный OCR',
  ocr_screen_awareness_visual_rules: 'Визуальные правила распознавания',
  pending_ocr_advance_captures: 'Ожидающие сборки прокрутки',
  pending_summary_task_count: 'Число ожидающих задач сводки',
  pending_summary_tasks: 'Ожидающие задачи сводки',
  recommended_capture_profile: 'Рекомендованный профиль снимка',
  recommended_capture_profile_confidence: 'Уверенность рекомендации профиля',
  recommended_capture_profile_manual_present: 'Наличие ручной рекомендации',
  recommended_capture_profile_process_name: 'Процесс рекомендации профиля',
  recommended_capture_profile_reason: 'Причина рекомендации профиля',
  recommended_capture_profile_save_scope: 'Область сохранения рекомендации',
  recommended_capture_profile_stage: 'Стадия рекомендации профиля',
  scene_summary_line_interval: 'Интервал строк сводки',
  scene_summary_lines_since_push: 'Строк с последней сводки',
  scene_summary_lines_until_push: 'Строк до следующей сводки',
  screen_awareness_model_detail: 'Детали модели распознавания',
  screen_awareness_model_last_confidence: 'Последняя уверенность модели',
  screen_awareness_model_last_stage: 'Последняя стадия модели',
  screen_awareness_sample_count: 'Число образцов распознавания',
  screen_classify_keywords: 'Ключевые слова классификации',
  screen_classify_layout: 'Разметка классификации',
  screen_classify_reason: 'Причина классификации',
  screen_text_sources: 'Источники текста на экране',
  stability: 'Стабильность',
  summary_last_drop: 'Последний отброс сводки',
  summary_last_retry_reason: 'Причина последней повторной сводки',
  summary_last_scheduled: 'Последнее расписание сводки',
  summary_last_skip: 'Последний пропуск сводки',
  summary_last_task_cancelled: 'Отмена последней задачи сводки',
  summary_last_task_exception: 'Исключение последней задачи сводки',
  summary_last_task_restored_schedule: 'Восстановленное расписание задачи',
  summary_last_task_returned_false: 'Последняя задача вернула false',
  summary_peek_session_transition: 'Превью перехода сессии',
  summary_scene_states: 'Состояния сцен сводки',
  summary_thresholds: 'Пороги сводки',
  vision_snapshot_available: 'Снимок Vision доступен',
  vision_snapshot_byte_size: 'Размер снимка Vision, байт',
  vision_snapshot_captured_at: 'Время снимка Vision',
  vision_snapshot_expires_at: 'Истечение снимка Vision',
  vision_snapshot_size: 'Размер снимка Vision',
  vision_snapshot_source: 'Источник снимка Vision',};

const CONNECTION_STATE_LABELS_ZH = {
  active: 'Активно',
  idle: 'Ожидание',
  stale: 'Устарело',
};

const MODE_LABELS_ZH = {
  silent: 'Тихий',
  companion: 'Сопровождение',
  choice_advisor: 'Автопродвижение',
  narrator: 'Рассказчик',
};

const TTS_PIPELINE_LABELS_ZH = {
  agent: 'Через агента',
  direct: 'Напрямую',
  off: 'Выкл',
};
const ADVANCE_SPEED_LABELS_ZH = {
  slow: 'Медленно',
  medium: 'Средне',
  fast: 'Быстро',
};

const AGENT_USER_STATUS_LABELS_ZH = {
  running: 'Выполняется',
  read_only: 'Режим чтения',
  paused_by_user: 'Ожидание пользователя',
  paused_window_not_foreground: 'Окно игры не на переднем плане',
  screen_safety_pause: 'Безопасная пауза',
  ocr_unavailable: 'OCR недоступен',
  waiting_choice: 'Ожидание/обработка выбора',
  acting: 'Выполняется действие',
  error: 'Ошибка',
};

const DATA_SOURCE_LABELS_ZH = {
  bridge_sdk: 'Bridge SDK',
  ocr_reader: 'OCR Reader',
  memory_reader: 'Memory Reader',
};

const READER_MODE_LABELS_ZH = {
  auto: 'Авто (сначала текст из памяти, затем OCR после остановки)',
  memory_reader: 'Memory Reader',
  ocr_reader: 'OCR',
};

const ACTION_LABELS_ZH = {
  refresh_all: 'Обновить все',
  debug_details: 'Показать отладку',
  refresh_ocr_windows: 'Обновить окна',
  select_ocr_window: 'Выбрать окно игры',
  focus_game: 'Вернуться к окну игры',
  capture_backend: 'Сменить бэкенд захвата',
  recalibrate_ocr: 'Перекалибровать OCR',
  line_details: 'Показать детали распознавания',
  choice_advisor: 'Переключить на автопродвижение',
  install_dxcam: 'Установить DXcam',
  refresh_status: 'Обновить статус',
  start_recognition: 'Начать авто распознавание',
};

function mapLabel(i18nKeys, labels, key, fallback = '') {
  const normalized = String(key || '').trim();
  const fallbackText = labels[normalized] || fallback || normalized;
  const i18nKey = i18nKeys[normalized];
  return i18nKey ? uiT(i18nKey, fallbackText) : fallbackText;
}

function fieldLabel(key) {
  return uiDynamicT('ui.field', key, FIELD_LABELS_ZH[key] || key);
}

function agentUserStatusLabel(key, fallback = '') {
  return uiDynamicT('ui.agent_status', key, AGENT_USER_STATUS_LABELS_ZH[key] || fallback || key);
}

function ocrProfileStageLabel(key, fallback = '') {
  return mapLabel(OCR_PROFILE_STAGE_I18N_KEYS, OCR_PROFILE_STAGE_LABELS_ZH, key, fallback);
}

function ocrCaptureMatchSourceLabel(key, fallback = '') {
  return mapLabel(OCR_CAPTURE_MATCH_SOURCE_I18N_KEYS, OCR_CAPTURE_MATCH_SOURCE_LABELS_ZH, key, fallback);
}

function ocrCaptureSaveScopeLabel(key, fallback = '') {
  return mapLabel(OCR_CAPTURE_SAVE_SCOPE_I18N_KEYS, OCR_CAPTURE_SAVE_SCOPE_LABELS_ZH, key, fallback);
}

function connectionStateLabel(key, fallback = '') {
  return uiDynamicT('ui.connection_state', key, CONNECTION_STATE_LABELS_ZH[key] || fallback || key);
}

function modeLabel(key, fallback = '') {
  return uiDynamicT('ui.mode_label', key, MODE_LABELS_ZH[key] || fallback || key);
}

function ttsPipelineLabel(key, fallback = '') {
  const normalized = String(key || '').trim().toLowerCase();
  return uiDynamicT('ui.tts.pipeline', normalized, TTS_PIPELINE_LABELS_ZH[normalized] || fallback || normalized || 'agent');
}

function advanceSpeedLabel(key, fallback = '') {
  return uiDynamicT('ui.speed_label', key, ADVANCE_SPEED_LABELS_ZH[key] || fallback || key);
}

function dataSourceLabel(key, fallback = '') {
  return uiDynamicT('ui.data_source', key, DATA_SOURCE_LABELS_ZH[key] || fallback || key);
}

function captureBackendLabel(key, fallback = '') {
  const normalized = textValue(key).toLowerCase();
  const labels = {
    auto: uiT('ui.capture_backend.auto', 'Авто'),
    smart: uiT('ui.capture_backend.smart', 'Smart'),
    dxcam: uiT('ui.capture_backend.dxcam', 'DXcam'),
    mss: uiT('ui.capture_backend.mss', 'MSS'),
    imagegrab: uiT('ui.capture_backend.mss', 'MSS'),
    pyautogui: uiT('ui.capture_backend.pyautogui', 'PyAutoGUI'),
    printwindow: uiT('ui.capture_backend.printwindow', 'PrintWindow'),
  };
  return labels[normalized] || fallback || key || uiT('ui.status.unknown', 'Неизвестно');
}

function requiresDxcamBackend(key) {
  return textValue(key).toLowerCase() === 'dxcam';
}

function hasInstallFlow(kind) {
  return Boolean(getInstallUIConfig()[kind]);
}

function readerModeLabel(key, fallback = '') {
  return uiDynamicT('ui.reader_mode', key, READER_MODE_LABELS_ZH[key] || fallback || key);
}

function primaryActionLabel(id, fallback = '') {
  return uiDynamicT('ui.action', id, ACTION_LABELS_ZH[id] || fallback || id);
}

function diagnosisAction(id, fallback = '') {
  return { id, label: primaryActionLabel(id, fallback || id) };
}

let latestAgentReply = uiT('ui.agent.no_interaction', 'Нет взаимодействий');
let latestAgentStatus = null;
let latestStatus = null;
let latestSnapshotData = null;
let latestMemoryProcessSnapshot = null;
let latestOcrWindowSnapshot = null;
let latestCharacterProfileSnapshot = null;
let onboardingDismissed = false;
let forceShowOnboarding = false;
let lastSavedStepIndex = -1;
let latestTutorialProgress = null;
let tutorialProgressSaveQueue = Promise.resolve();
const tutorialProgressPendingSaveKeys = new Set();
let refreshInFlight = null;
let memoryProcessRefreshInFlight = null;
let ocrWindowRefreshInFlight = null;
let characterProfileRefreshInFlight = null;
let lastMemoryProcessRefreshAt = 0;
let lastOcrWindowRefreshAt = 0;
let lastCharacterProfileRefreshAt = 0;
let lastCharacterProfileGameId = '';
let emptyOcrWindowFocusForceRefreshDone = false;
let autoRefreshTimer = null;
let autoRefreshIntervalMs = AUTO_REFRESH_INTERVAL_MS;
let settingsDirty = false;
let settingsSaveInFlight = false;
let pendingModeSelection = '';
let modeSaveRequestId = 0;
let settingsAutosaveTimer = null;
let flashTimer = null;
let flashToken = 0;

function fetchWithTutorialTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, TUTORIAL_PROGRESS_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function hideOnboardingWithoutSkipping() {
  onboardingDismissed = true;
  forceShowOnboarding = false;
  document.body.classList.remove('onboarding-active');
  const onboardingView = document.getElementById('onboardingView');
  if (onboardingView) {
    onboardingView.hidden = true;
  }
}

const SETTINGS_CONTROL_IDS = new Set([
  'modeSelect',
  'pushToggle',
  'advanceSpeedSelect',
  'readerModeSelect',
  'ocrPollIntervalInput',
  'ocrTriggerModeSelect',
  'llmVisionToggle',
  'fastLoopToggle',
  'llmVisionMaxImagePxInput',
]);

const latestInsights = {
  suggestKey: '',
  suggestPayload: null,
};

function getInstallConfig(kind) {
  const config = getInstallUIConfig()[kind];
  if (!config) {
    throw new Error(`unsupported install kind: ${kind}`);
  }
  return config;
}

function getInstallState(kind) {
  return installRuntime[kind];
}

function getInstallNodes(kind) {
  const config = getInstallConfig(kind);
  const prefix = config.domPrefix;
  return {
    card: document.getElementById(`${prefix}InstallCard`) || document.getElementById(`${prefix}InstallState`),
    statusText: document.getElementById(`${prefix}InstallStatusText`),
    percentText: document.getElementById(`${prefix}InstallPercent`),
    messageText: document.getElementById(`${prefix}InstallMessage`),
    detailText: document.getElementById(`${prefix}InstallDetail`),
    progressBar: document.getElementById(`${prefix}InstallBar`),
    button: document.getElementById(config.buttonId || `${prefix}InstallBtn`),
  };
}

function configureUseButton(id, { active = false, disabled = false, text = '', title = '' } = {}) {
  const button = document.getElementById(id);
  if (!button) {
    return;
  }
  if (text) {
    button.textContent = text;
  }
  button.disabled = Boolean(disabled || active);
  button.classList.toggle('active', Boolean(active));
  button.title = title || '';
}

function setActionButtonDisabled(button, disabled) {
  const nextDisabled = Boolean(disabled);
  if (button.disabled !== nextDisabled) {
    button.disabled = nextDisabled;
  }
  button.__galgameActionDesiredDisabled = nextDisabled;
}

function syncActionButtonElement(current, next) {
  const nextDisabled = next.hasAttribute('disabled');
  const attributeNames = new Set([
    ...Array.from(current.attributes, (attr) => attr.name),
    ...Array.from(next.attributes, (attr) => attr.name),
  ]);
  attributeNames.forEach((name) => {
    if (name === 'disabled') {
      return;
    }
    const nextValue = next.getAttribute(name);
    if (nextValue == null) {
      current.removeAttribute(name);
    } else if (current.getAttribute(name) !== nextValue) {
      current.setAttribute(name, nextValue);
    }
  });
  if (current.textContent !== next.textContent) {
    current.textContent = next.textContent;
  }
  setActionButtonDisabled(current, nextDisabled);
}

function canPatchActionButtons(currentChildren, nextChildren) {
  return currentChildren.length === nextChildren.length
    && nextChildren.every((next, index) => {
      const current = currentChildren[index];
      return current
        && current.tagName === next.tagName
        && (current.id || '') === (next.id || '')
        && (current.getAttribute('data-primary-action') || '') === (next.getAttribute('data-primary-action') || '');
    });
}

function syncActionButtons(actions, html) {
  const nextHtml = html || '';
  if (!actions || actions.dataset.renderedHtml === nextHtml) {
    return;
  }
  const template = document.createElement('template');
  template.innerHTML = nextHtml.trim();
  const currentChildren = Array.from(actions.children);
  const nextChildren = Array.from(template.content.children);
  if (!canPatchActionButtons(currentChildren, nextChildren)) {
    actions.innerHTML = nextHtml;
    actions.dataset.renderedHtml = nextHtml;
    Array.from(actions.children).forEach((button) => {
      if (button instanceof HTMLButtonElement) {
        setActionButtonDisabled(button, button.disabled);
      }
    });
    return;
  }
  currentChildren.forEach((current, index) => {
    syncActionButtonElement(current, nextChildren[index]);
  });
  actions.dataset.renderedHtml = nextHtml;
}

function rebindCardButton(id, handler) {
  const button = document.getElementById(id);
  if (!button) {
    return;
  }
  button.__galgameCardClickHandler = handler;
  if (button.__galgameCardClickBound) {
    return;
  }
  button.__galgameCardClickBound = true;
  button.addEventListener('click', async () => {
    if (button.disabled) {
      return;
    }
    button.disabled = true;
    try {
      const currentHandler = button.__galgameCardClickHandler;
      if (typeof currentHandler === 'function') {
        await currentHandler();
      }
    } finally {
      button.disabled = Boolean(button.__galgameActionDesiredDisabled);
    }
  });
}

async function createRun(entryId, args = {}) {
  const createResp = await fetch(RUNS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plugin_id: PLUGIN_ID,
      entry_id: entryId,
      args,
    }),
  });

  if (!createResp.ok) {
    throw new Error(uiTf('ui.error.run_create_failed', 'Не удалось создать задачу: HTTP {status}', { status: createResp.status }));
  }

  const createData = await createResp.json();
  const runId = createData.run_id || createData.id;
  if (!runId) {
    throw new Error(uiT('ui.error.run_id_missing', 'run_id не получен'));
  }
  return runId;
}

async function exportRunResult(runId) {
  const exportResp = await fetch(`${RUNS_URL}/${runId}/export`);
  if (!exportResp.ok) {
    return {};
  }
  const exportData = await exportResp.json();
  const items = exportData.items || [];
  const resultItem = items.find((item) => item.type === 'json' && item.json) || items[0];
  const pluginResponse = resultItem ? (resultItem.json || {}) : {};
  if (pluginResponse.success === false || pluginResponse.error) {
    throw new Error(pluginResponse.error?.message || pluginResponse.message || uiT('ui.error.plugin_call_failed', 'Вызов плагина не удался'));
  }
  return pluginResponse.data || {};
}

async function callPlugin(entryId, args = {}, { timeoutMs } = {}) {
  const runId = await createRun(entryId, args);
  const deadline = Date.now() + (timeoutMs ?? PLUGIN_RUN_TIMEOUT_MS);
  let pollDelay = PLUGIN_RUN_INITIAL_POLL_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollDelay));
    pollDelay = Math.min(Math.round(pollDelay * 1.5), PLUGIN_RUN_MAX_POLL_MS);
    const pollResp = await fetch(`${RUNS_URL}/${runId}`);
    if (!pollResp.ok) {
      if ([404, 405, 501].includes(pollResp.status)) {
        console.error('[galgame] callPlugin permanent error', pollResp.status, entryId);
        throw new Error(`Plugin call failed with ${pollResp.status}`);
      }
      continue;
    }

    const runRecord = await pollResp.json();
    if (runRecord.status === 'succeeded') {
      return await exportRunResult(runId);
    }

    if (['failed', 'canceled', 'timeout'].includes(runRecord.status)) {
      throw new Error(runRecord.error?.message || runRecord.message || runRecord.status);
    }
  }

  throw new Error(uiT('ui.error.plugin_call_timeout', 'Вызов плагина истек по времени'));
}

async function safeCall(entryId, args = {}, fallback = {}) {
  try {
    return await callPlugin(entryId, args);
  } catch (error) {
    return {
      ...fallback,
      degraded: true,
      diagnostic: error instanceof Error ? error.message : String(error),
    };
  }
}

function escapeHtml(text) {
  if (text == null) {
    return '';
  }
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function setFlash(message, type = 'info') {
  const node = document.getElementById('flashMessage');
  flashToken += 1;
  const token = flashToken;
  if (flashTimer) {
    clearTimeout(flashTimer);
    flashTimer = null;
  }
  node.hidden = !message;
  node.textContent = message || '';
  node.className = `flash-message ${type}`;
  if (message && ['success', 'info'].includes(type)) {
    flashTimer = window.setTimeout(() => {
      if (flashToken !== token) {
        return;
      }
      node.hidden = true;
      node.textContent = '';
      flashTimer = null;
    }, FLASH_AUTO_HIDE_MS);
  }
}

function isPluginNotStartedError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes("Plugin 'galgame_plugin' is registered but not running");
}

function updateSettingsDirtyHint(message = '') {
  const hint = document.getElementById('settingsDirtyHint');
  if (!hint) {
    return;
  }
  if (settingsSaveInFlight) {
    hint.hidden = false;
    hint.textContent = message || uiT('ui.settings.saving_hint', 'Сохранение...');
    return;
  }
  hint.hidden = !settingsDirty;
  hint.textContent = message || uiT('ui.settings.dirty', 'Есть несохраненные настройки');
}

function hasMissingRapidOcrModelFiles(rapidocr = {}) {
  return rapidocr.detail === 'missing_model_files';
}

function isRapidOcrUsable(rapidocr = {}) {
  return Boolean(rapidocr.installed) && !hasMissingRapidOcrModelFiles(rapidocr);
}

function textValue(value) {
  return String(value == null ? '' : value).trim();
}

function statusBoolValue(primary, fallback = undefined) {
  if (typeof primary === 'boolean') {
    return primary;
  }
  if (typeof fallback === 'boolean') {
    return fallback;
  }
  return Boolean(primary || fallback);
}

function lineText(line = {}) {
  return textValue(line && typeof line === 'object' ? line.text : '');
}

function lineStability(line = {}) {
  return textValue(line && typeof line === 'object' ? line.stability : '').toLowerCase();
}

function isStableLine(line = {}) {
  if (!line || typeof line !== 'object') {
    return false;
  }
  const stability = lineStability(line);
  if (stability) {
    return stability === 'stable';
  }
  const source = textValue(line.source).toLowerCase();
  return source === 'stable' || source === 'history';
}

function compactLineText(value) {
  return textValue(value).replace(/\s+/g, '');
}

function getCurrentLineTexts(status = {}) {
  const runtime = status.ocr_reader_runtime || {};
  const effectiveLine = (
    status.effective_current_line && typeof status.effective_current_line === 'object'
      ? status.effective_current_line
      : {}
  );
  const observedLine = (
    runtime.last_observed_line && typeof runtime.last_observed_line === 'object'
      ? runtime.last_observed_line
      : {}
  );
  const stableText = lineText(runtime.last_stable_line)
    || (isStableLine(effectiveLine) ? lineText(effectiveLine) : '');
  const effectiveText = lineText(effectiveLine);
  const observedText = lineText(observedLine)
    || (!isStableLine(effectiveLine) ? effectiveText : '');
  const rawText = textValue(runtime.last_raw_ocr_text);
  return {
    rawText,
    observedText,
    stableText,
    effectiveText,
  };
}

function formatStableBlockReason(reason) {
  const mapping = {
    waiting_for_repeat: uiT('ui.reason.stable.waiting_for_repeat', 'Обнаружен новый текст; проверяется, та же ли это реплика'),
    duplicate_stable_text: uiT('ui.reason.stable.duplicate_stable_text', 'Эта реплика уже отображалась'),
    duplicate_raw_text: uiT('ui.reason.stable.duplicate_raw_text', 'Результат распознавания совпадает с предыдущим проходом, поэтому повторно не записывается'),
    duplicate_observed_text: uiT('ui.reason.stable.duplicate_observed_text', 'Реплика-кандидат совпадает с предыдущим проходом и ожидает изменения'),
    duplicate_candidate_text: uiT('ui.reason.stable.duplicate_candidate_text', 'Реплика-кандидат совпадает с предыдущим проходом и ожидает изменения'),
    empty_text: uiT('ui.reason.stable.empty_text', 'Распознавание текста пока не прочитало допустимый текст'),
    no_text: uiT('ui.reason.stable.no_text', 'Распознавание текста пока не прочитало допустимый текст'),
    no_valid_text: uiT('ui.reason.stable.no_valid_text', 'Распознавание текста пока не прочитало допустимый текст'),
    low_confidence: uiT('ui.reason.stable.low_confidence', 'Уверенность распознавания низкая, поэтому реплика пока не записывается'),
    overlay_text: uiT('ui.reason.stable.overlay_text', 'Результат распознавания похож на системный UI, поэтому пока не записывается'),
    game_overlay_text: uiT('ui.reason.stable.game_overlay_text', 'Результат распознавания похож на меню игры или системный UI, поэтому пока не записывается'),
    waiting_for_change: uiT('ui.reason.stable.waiting_for_change', 'Текст на экране не изменился; ожидание новой реплики'),
    waiting_for_new_text: uiT('ui.reason.stable.waiting_for_new_text', 'Ожидание появления новой реплики'),
    capture_failed: uiT('ui.reason.stable.capture_failed', 'Захват или распознавание не удалось, поэтому реплику нельзя подтвердить'),
  };
  const normalized = textValue(reason);
  return uiDynamicT('ui.reason.stable', normalized, mapping[normalized] || normalized);
}

function formatOcrTickBlockReason(reason) {
  const mapping = {
    ocr_reader_unavailable: uiT('ui.reason.tick.ocr_reader_unavailable', 'OCR Reader пока недоступен'),
    ocr_reader_not_allowed: uiT('ui.reason.tick.ocr_reader_not_allowed', 'Текущий режим чтения не разрешает OCR'),
    reader_mode_memory_only: uiT('ui.reason.tick.reader_mode_memory_only', 'Текущий режим — только чтение памяти'),
    memory_reader_recent_text: uiT('ui.reason.tick.memory_reader_recent_text', 'Memory Reader имеет недавний текст, поэтому OCR пока не опрашивается'),
    memory_reader_default_unavailable: uiT('ui.reason.tick.memory_reader_default_unavailable', 'Цель Memory Reader по умолчанию пока недоступна, поэтому OCR не был выбран активно'),
    waiting_pending_advance_delay: uiT('ui.reason.tick.waiting_pending_advance_delay', 'Ожидание задержанного окна захвата после продвижения'),
    trigger_mode_after_advance_waiting_for_input: uiT('ui.reason.tick.trigger_mode_after_advance_waiting_for_input', 'Режим распознавания после клика ожидает продвижения игры'),
    trigger_mode_after_advance_waiting_for_refresh: uiT('ui.reason.tick.trigger_mode_after_advance_waiting_for_refresh', 'Режим распознавания после клика ожидает условий обновления'),
    tick_gate_closed: uiT('ui.reason.tick.tick_gate_closed', 'Шлюз OCR-опроса закрыт'),
    plugin_config_missing: uiT('ui.reason.tick.plugin_config_missing', 'Конфигурация плагина пока не готова'),
    ocr_reader_manager_missing: uiT('ui.reason.tick.ocr_reader_manager_missing', 'Менеджер OCR Reader пока не готов'),
    ocr_fast_loop_started: uiT('ui.reason.tick.ocr_fast_loop_started', 'OCR Fast Loop взял на себя этот проход захвата'),
    ocr_tick_lock_busy: uiT('ui.reason.tick.ocr_tick_lock_busy', 'Предыдущий OCR tick еще выполняется'),
    tick_gate_timeout: uiT('ui.reason.tick.tick_gate_timeout', 'Шлюз захвата после продвижения истек и был очищен'),
    trigger_mode_not_after_advance: uiT('ui.reason.tick.trigger_mode_not_after_advance', 'Текущий режим триггера не является распознаванием после клика'),
    refresh_method_missing: uiT('ui.reason.tick.refresh_method_missing', 'Метод обновления переднего плана недоступен'),
    refresh_failed: uiT('ui.reason.tick.refresh_failed', 'Обновление переднего плана не удалось'),
    target_missing: uiT('ui.reason.tick.target_missing', 'Целевое окно игры не существует'),
    target_minimized: uiT('ui.reason.tick.target_minimized', 'Целевое окно игры свернуто'),
    target_not_visible: uiT('ui.reason.tick.target_not_visible', 'Целевое окно игры не видно'),
    target_not_foreground: uiT('ui.reason.tick.target_not_foreground', 'Целевое окно игры не на переднем плане'),
    capture_failed: uiT('ui.reason.tick.capture_failed', 'Захват или распознавание текста не удалось'),
    stale_capture_backend: uiT('ui.reason.tick.stale_capture_backend', 'Изображение захвата не обновляется'),
  };
  const normalized = textValue(reason);
  return uiDynamicT('ui.reason.tick', normalized, mapping[normalized] || normalized);
}

function formatOcrEmitBlockReason(reason) {
  const mapping = {
    capture_failed: uiT('ui.reason.emit.capture_failed', 'Захват или распознавание текста не удалось'),
    stale_capture_backend: uiT('ui.reason.emit.stale_capture_backend', 'Изображение захвата не обновляется'),
    screen_classification_skipped_dialogue: uiT('ui.reason.emit.screen_classification_skipped_dialogue', 'Экран классифицирован как не диалоговый'),
    no_dialogue_text: uiT('ui.reason.emit.no_dialogue_text', 'Нет диалогового текста для записи'),
    ...{
      waiting_for_repeat: formatStableBlockReason('waiting_for_repeat'),
      duplicate_stable_text: formatStableBlockReason('duplicate_stable_text'),
      duplicate_raw_text: formatStableBlockReason('duplicate_raw_text'),
      duplicate_observed_text: formatStableBlockReason('duplicate_observed_text'),
      duplicate_candidate_text: formatStableBlockReason('duplicate_candidate_text'),
      empty_text: formatStableBlockReason('empty_text'),
      no_text: formatStableBlockReason('no_text'),
      no_valid_text: formatStableBlockReason('no_valid_text'),
      low_confidence: formatStableBlockReason('low_confidence'),
      overlay_text: formatStableBlockReason('overlay_text'),
      game_overlay_text: formatStableBlockReason('game_overlay_text'),
      waiting_for_change: formatStableBlockReason('waiting_for_change'),
      waiting_for_new_text: formatStableBlockReason('waiting_for_new_text'),
    },
  };
  const normalized = textValue(reason);
  return uiDynamicT('ui.reason.emit', normalized, mapping[normalized] || formatStableBlockReason(normalized));
}

function formatOcrBackgroundState(state) {
  const mapping = {
    background_polling: uiT('ui.ocr.background_state.background_polling', 'Фоновый опрос'),
    foreground_resume_pending: uiT('ui.ocr.background_state.foreground_resume_pending', 'Ожидание возврата на передний план'),
    visible_background_readable: uiT('ui.ocr.background_state.visible_background_readable', 'Видимый фон доступен для чтения'),
    capture_backend_blocked: uiT('ui.ocr.background_state.capture_backend_blocked', 'Бэкенд захвата заблокирован'),
    target_unavailable: uiT('ui.ocr.background_state.target_unavailable', 'Целевое окно недоступно'),
    foreground_active: uiT('ui.ocr.background_state.foreground_active', 'Захват переднего плана доступен'),
    idle: uiT('ui.ocr.background_state.idle', 'Неактивно'),
  };
  const normalized = textValue(state);
  return uiDynamicT('ui.ocr.background_state', normalized, mapping[normalized] || normalized);
}

function normalizePrimaryDiagnosis(diagnosis) {
  if (!diagnosis || typeof diagnosis !== 'object') {
    return null;
  }
  const severity = textValue(diagnosis.severity);
  const rawTitle = textValue(diagnosis.title);
  const rawBody = textValue(diagnosis.message || diagnosis.body);
  const titleKey = textValue(diagnosis.title_i18n_key || diagnosis.title_key);
  const bodyKey = textValue(diagnosis.message_i18n_key || diagnosis.body_i18n_key || diagnosis.message_key || diagnosis.body_key);
  const title = titleKey ? uiT(titleKey, rawTitle) : rawTitle;
  const body = bodyKey ? uiT(bodyKey, rawBody) : rawBody;
  if (!title && !body) {
    return null;
  }
  const actions = Array.isArray(diagnosis.actions)
    ? diagnosis.actions.map((action) => {
      if (!action || typeof action !== 'object') {
        return null;
      }
      const id = textValue(action.id);
      if (!id) {
        return null;
      }
      return {
        id,
        label: textValue(action.label || action.title || id) || id,
      };
    }).filter(Boolean)
    : [];
  return {
    severity: ['ok', 'info', 'warning', 'error'].includes(severity) ? severity : 'info',
    title: title || uiT('ui.diag.default_title', 'Диагностика выполнения'),
    body,
    actions,
  };
}

function buildPrimaryDiagnosis(status = {}) {
  const backendDiagnosis = normalizePrimaryDiagnosis(status.primary_diagnosis);
  if (backendDiagnosis) {
    return backendDiagnosis;
  }
  const diagnose = (diagnosis) => diagnosis;

  const runtime = status.ocr_reader_runtime || {};
  const detail = textValue(runtime.target_selection_detail);
  const contextState = textValue(status.ocr_context_state || runtime.ocr_context_state);
  const lastExcludeReason = textValue(runtime.last_exclude_reason);
  const lastCaptureError = textValue(runtime.last_capture_error);
  const lastRejectedReason = textValue(runtime.last_rejected_ocr_reason);
  const lastError = textValue(status.last_error && status.last_error.message);
  const agentPauseKind = textValue(status.agent_pause_kind);
  const agentUserStatus = textValue(status.agent_user_status);
  const backgroundStatus = status.ocr_background_status || {};
  const intervalBackgroundBlocked = (
    textValue(backgroundStatus.state || status.ocr_background_state) === 'capture_backend_blocked'
    && textValue(backgroundStatus.trigger_mode || status.ocr_reader_trigger_mode) === 'interval'
    && runtime.target_is_foreground === false
  );
  const { rawText, observedText, stableText, effectiveText } = getCurrentLineTexts(status);
  const observedKey = compactLineText(observedText);
  const stableKey = compactLineText(stableText);
  const hasEffectiveWindow = Boolean(textValue(runtime.effective_window_key));
  const candidateCount = Number(runtime.candidate_count || 0);
  const tickBlockReason = textValue(status.ocr_tick_block_reason || runtime.ocr_tick_block_reason);
  const emitBlockReason = textValue(status.ocr_emit_block_reason || runtime.ocr_emit_block_reason);
  const connectionState = textValue(status.connection_state);
  const hasOcrRuntimeSignal = Boolean(
    status.ocr_reader_enabled
    || runtime.status
    || runtime.detail
    || contextState
    || detail
    || Object.prototype.hasOwnProperty.call(runtime, 'candidate_count')
  );

  if (connectionState === 'plugin_not_started') {
    return diagnose({
      severity: 'info',
      title: uiT('ui.diag.plugin_not_started.title', 'Плагин не запущен'),
      body: uiT('ui.diag.plugin_not_started.body', 'Нажмите "Запустить" на странице управления плагином. После запуска данные обновятся автоматически.'),
      actions: [
        diagnosisAction('refresh_all'),
      ],
    });
  }

  if (lastError) {
    return diagnose({
      severity: 'error',
      title: uiT('ui.diag.plugin_error.title', 'Ошибка выполнения плагина'),
      body: uiTf('ui.diag.plugin_error.body', '{error}. Сначала обновите статус; если ошибка повторится, откройте детали отладки.', { error: lastError }),
      actions: [
        diagnosisAction('refresh_all'),
        diagnosisAction('debug_details'),
      ],
    });
  }

  if (detail === 'memory_reader_window_minimized' || lastExcludeReason === 'excluded_minimized_window') {
    return diagnose({
      severity: 'warning',
      title: uiT('ui.diag.window_minimized.title', 'Окно игры свернуто'),
      body: uiT('ui.diag.window_minimized.body', 'Игра обнаружена, но окно свернуто, поэтому OCR не может сделать снимок. Разверните окно игры и продолжите.'),
      actions: [
        diagnosisAction('refresh_ocr_windows'),
        diagnosisAction('select_ocr_window'),
      ],
    });
  }

  if (contextState === 'capture_failed' || lastCaptureError) {
    const captureFailure = lastCaptureError || uiT('ui.diag.capture_failed.default_error', 'Бэкенд захвата или распознавания вернул ошибку, новые реплики не будут обновляться.');
    return diagnose({
      severity: 'error',
      title: uiT('ui.diag.capture_failed.title', 'Не удалось сделать снимок или распознать текст'),
      body: intervalBackgroundBlocked
        ? uiTf('ui.diag.capture_failed.interval_body', '{error} Сейчас используется фоновое OCR по интервалу. Убедитесь, что окно видно и не свернуто; если ошибка сохранится, смените способ захвата или заново выберите окно OCR.', { error: captureFailure })
        : captureFailure,
      actions: intervalBackgroundBlocked
        ? [
          diagnosisAction('focus_game'),
          diagnosisAction('capture_backend'),
          diagnosisAction('select_ocr_window'),
          diagnosisAction('debug_details'),
        ]
        : [
          diagnosisAction('recalibrate_ocr'),
          diagnosisAction('capture_backend'),
          diagnosisAction('debug_details'),
        ],
    });
  }

  if (runtime.stale_capture_backend) {
    return diagnose({
      severity: 'warning',
      title: uiT('ui.diag.stale_capture.title', 'Снимок не обновляется'),
      body: intervalBackgroundBlocked
        ? uiT('ui.diag.stale_capture.interval_body', 'При фоновом OCR по интервалу снимок не обновляется. Убедитесь, что окно игры видно и не свернуто; если кадр все еще старый, смените способ захвата или заново выберите окно OCR.')
        : uiT('ui.diag.stale_capture.body', 'Текущий источник захвата мог застрять на старом кадре. Вернитесь в окно игры или смените способ захвата и попробуйте снова.'),
      actions: intervalBackgroundBlocked
        ? [
          diagnosisAction('focus_game'),
          diagnosisAction('capture_backend'),
          diagnosisAction('select_ocr_window'),
        ]
        : [
          diagnosisAction('focus_game'),
          diagnosisAction('capture_backend'),
          diagnosisAction('refresh_ocr_windows'),
        ],
    });
  }

  if (tickBlockReason === 'trigger_mode_after_advance_waiting_for_input') {
    return diagnose({
      severity: 'info',
      title: uiT('ui.diag.waiting_advance.title', 'OCR ждет продвижения игры'),
      body: uiT('ui.diag.waiting_advance.body', 'Включен режим распознавания после клика по диалогу, предыдущий проход завершен. Новый захват начнется после клика, прокрутки вниз или клавиши продвижения.'),
      actions: [
        diagnosisAction('focus_game'),
        diagnosisAction('debug_details'),
      ],
    });
  }

  if (tickBlockReason === 'memory_reader_recent_text') {
    return diagnose({
      severity: 'info',
      title: uiT('ui.diag.memory_priority.title', 'Memory Reader сейчас дает текст первым'),
      body: uiT('ui.diag.memory_priority.body', 'В авто режиме найден свежий текст Memory Reader, поэтому OCR пока не опрашивается активно.'),
      actions: [
        diagnosisAction('debug_details'),
      ],
    });
  }

  if (tickBlockReason) {
    return diagnose({
      severity: 'info',
      title: uiT('ui.diag.ocr_tick_blocked.title', 'OCR polling еще не выполнялся'),
      body: formatOcrTickBlockReason(tickBlockReason),
      actions: [
        diagnosisAction('refresh_all'),
        diagnosisAction('debug_details'),
      ],
    });
  }

  if (emitBlockReason === 'screen_classification_skipped_dialogue') {
    return diagnose({
      severity: 'warning',
      title: uiT('ui.diag.non_dialogue.title', 'OCR определил экран как не диалоговый'),
      body: uiT('ui.diag.non_dialogue.body', 'Снимок и распознавание выполнены, но классификация экрана считает текущий экран неподходящим для записи диалога.'),
      actions: [
        diagnosisAction('recalibrate_ocr'),
        diagnosisAction('debug_details'),
      ],
    });
  }

  if (['duplicate_stable_text', 'waiting_for_repeat', 'no_dialogue_text'].includes(emitBlockReason)) {
    return diagnose({
      severity: 'info',
      title: uiT('ui.diag.no_new_line.title', 'OCR выполнен, но новой реплики нет'),
      body: formatOcrEmitBlockReason(emitBlockReason),
      actions: [
        diagnosisAction('line_details'),
        diagnosisAction('debug_details'),
      ],
    });
  }

  if (
    detail === 'no_eligible_window'
    || (!hasEffectiveWindow && candidateCount === 0 && hasOcrRuntimeSignal)
  ) {
    return diagnose({
      severity: 'warning',
      title: uiT('ui.diag.no_window.title', 'Не найдено распознаваемое окно игры'),
      body: uiT('ui.diag.no_window.body', 'Игра может быть не запущена, свернута, или текущее окно не является игрой. Убедитесь, что окно игры видно, и обновите.'),
      actions: [
        diagnosisAction('refresh_ocr_windows'),
        diagnosisAction('select_ocr_window'),
      ],
    });
  }

  if (detail === 'foreground_window_needs_manual_confirmation' || detail === 'auto_detect_needs_manual_fallback') {
    return diagnose({
      severity: 'warning',
      title: uiT('ui.diag.manual_window.title', 'Нужно вручную выбрать окно игры'),
      body: uiT('ui.diag.manual_window.body', 'Автоопределение недостаточно уверенно. Однократный ручной выбор поможет не распознавать страницу плагина или другое окно.'),
      actions: [
        diagnosisAction('select_ocr_window'),
        diagnosisAction('refresh_ocr_windows'),
      ],
    });
  }

  if (
    rawText.length > 400
    && hasOcrRuntimeSignal
    && textValue(status.active_data_source) === 'ocr_reader'
  ) {
    return diagnose({
      severity: 'warning',
      title: uiT('ui.diag.ocr_text_too_long.title', 'Текст OCR слишком длинный'),
      body: uiTf(
        'ui.diag.ocr_text_too_long.body', 'Сейчас распознано {length} символов, что намного больше обычной реплики. Возможно, область захвата включает не диалоговый текст. Закрепите правильное окно и откалибруйте область диалога.',
        { length: String(rawText.length) },
      ),
      actions: [
        diagnosisAction('select_ocr_window'),
        diagnosisAction('recalibrate_ocr'),
      ],
    });
  }

  const lastPollDuration = Number(runtime.last_poll_duration_seconds || 0);
  if (
    lastPollDuration > 5.0
    && hasOcrRuntimeSignal
    && textValue(status.active_data_source) === 'ocr_reader'
  ) {
    const saLatency = Number(runtime.screen_awareness_model_last_latency_seconds || 0);
    if (saLatency > 3.0) {
      const body = uiTf('ui.diag.ocr_poll_too_slow.body_with_sa', 'Последний опрос OCR занял {seconds}s, что намного дольше нормы. Задержка модели анализа экрана тоже высокая ({saLatency}s). Закрепите окно, откалибруйте область диалога или уменьшите частоту анализа экрана / отключите OCR полного кадра.',
        { seconds: lastPollDuration.toFixed(1), saLatency: saLatency.toFixed(1) });
      return diagnose({
        severity: 'warning',
        title: uiT('ui.diag.ocr_poll_too_slow.title', 'OCR распознает слишком медленно'),
        body,
        actions: [
          diagnosisAction('select_ocr_window'),
          diagnosisAction('recalibrate_ocr'),
          diagnosisAction('capture_backend'),
        ],
      });
    }
    return diagnose({
      severity: 'warning',
      title: uiT('ui.diag.ocr_poll_too_slow.title', 'OCR распознает слишком медленно'),
      body: uiTf(
        'ui.diag.ocr_poll_too_slow.body', 'Последний опрос OCR занял {seconds}s, что намного дольше нормы. Обычно причина в слишком большой области захвата или неподходящем способе захвата. Закрепите окно, откалибруйте область диалога или попробуйте другой способ захвата.',
        { seconds: lastPollDuration.toFixed(1) },
      ),
      actions: [
        diagnosisAction('select_ocr_window'),
        diagnosisAction('recalibrate_ocr'),
        diagnosisAction('capture_backend'),
      ],
    });
  }

  if (observedKey && observedKey !== stableKey) {
    return diagnose({
      severity: 'info',
      title: uiT('ui.diag.observed_new.title', 'Обнаружен новый текст'),
      body: uiT('ui.diag.observed_new.body', 'Распознавание увидело кандидатную реплику и проверяет, та же ли это строка.'),
      actions: [
        diagnosisAction('line_details'),
      ],
    });
  }

  if (agentPauseKind === 'window_not_foreground' || agentUserStatus === 'paused_window_not_foreground') {
    return diagnose({
      severity: 'info',
      title: uiT('ui.diag.not_foreground.title', 'Игра не на переднем плане'),
      body: uiT('ui.diag.not_foreground.body', 'Автопродвижение приостановлено. После возврата в окно игры оно продолжится, а информация сопровождения продолжит обновляться.'),
      actions: [
        diagnosisAction('focus_game'),
      ],
    });
  }

  if (agentPauseKind === 'read_only' || agentUserStatus === 'read_only') {
    return diagnose({
      severity: 'info',
      title: uiT('ui.diag.read_only.title', 'Сейчас режим сопровождения'),
      body: uiT('ui.diag.read_only.body', 'Реплики и предложения отображаются, но автоматических кликов не будет. Для автопродвижения переключите режим.'),
      actions: [
        diagnosisAction('choice_advisor'),
      ],
    });
  }

  if (effectiveText || stableText) {
    const target = formatOcrTargetForUser(status);
    return diagnose({
      severity: 'ok',
      title: uiT('ui.diag.recognizing.title', 'Распознавание реплик'),
      body: target
        ? uiTf('ui.diag.recognizing.body_with_target', 'Текущая цель: {target}. Реплика прочитана, страница будет продолжать обновляться.', { target })
        : uiT('ui.diag.recognizing.body', 'Реплика прочитана, страница будет продолжать обновляться.'),
      actions: [
        diagnosisAction('refresh_all'),
      ],
    });
  }

  return diagnose({
    severity: 'info',
    title: uiT('ui.diag.waiting_game.title', 'Ожидание статуса игры'),
    body: status.summary || uiT('ui.diag.waiting_game.body', 'Пока недостаточно информации, чтобы определить блокер. Сначала откройте игру или обновите список окон.'),
    actions: [
      diagnosisAction('refresh_all'),
      diagnosisAction('select_ocr_window'),
    ],
  });
}

function renderPrimaryDiagnosis(status = {}) {
  const node = document.getElementById('primaryDiagnosisPanel');
  if (!node) {
    return;
  }
  const diagnosis = buildPrimaryDiagnosis(status);
  const kicker = document.getElementById('primaryDiagnosisKicker');
  const title = document.getElementById('primaryDiagnosisTitle');
  const body = document.getElementById('primaryDiagnosisBody');
  const actions = document.getElementById('primaryDiagnosisActions');
  node.className = `primary-diagnosis ${diagnosis.severity || 'info'}`;
  kicker.textContent = uiT('ui.diag.kicker', 'Диагностика');
  title.textContent = diagnosis.title;
  body.textContent = diagnosis.body;
  syncActionButtons(actions, (diagnosis.actions || []).map((action, index) => `
    <button class="${index === 0 ? 'primary' : 'secondary'}" data-primary-action="${escapeHtml(action.id)}">
      ${escapeHtml(primaryActionLabel(action.id, action.label))}
    </button>
  `).join(''));
}

function buildFirstRunStepsLegacy(status = {}) {
  const runtime = status.ocr_reader_runtime || {};
  const memoryRuntime = status.memory_reader_runtime || {};
  const snapshotWindows = latestOcrWindowSnapshot && Array.isArray(latestOcrWindowSnapshot.windows)
    ? latestOcrWindowSnapshot.windows
    : [];
  const availableGameIds = Array.isArray(status.available_game_ids) ? status.available_game_ids : [];
  const detail = textValue(runtime.target_selection_detail);
  const lastExcludeReason = textValue(runtime.last_exclude_reason);
  const hasGame = Boolean(
    textValue(status.active_session_id)
    || availableGameIds.length
    || Number(runtime.pid || 0)
    || textValue(runtime.process_name)
    || textValue(runtime.window_title)
    || Number(memoryRuntime.pid || 0)
    || textValue(memoryRuntime.process_name)
  );
  const hasWindow = Boolean(
    textValue(runtime.effective_window_key)
    || Number(runtime.candidate_count || 0) > 0
    || snapshotWindows.length > 0
  );
  const hasConfirmedWindow = Boolean(
    textValue(runtime.effective_window_key)
    && detail !== 'no_eligible_window'
    && detail !== 'memory_reader_window_minimized'
    && lastExcludeReason !== 'excluded_minimized_window'
  );
  const { observedText, stableText, effectiveText } = getCurrentLineTexts(status);
  const hasLine = Boolean(effectiveText || stableText || observedText);

  return [
    {
      done: hasGame,
      title: uiT('ui.first_run.start_game.title', 'Запустить или восстановить игру'),
      body: hasGame
        ? uiT('ui.first_run.start_game.done', 'Статус игры обнаружен.')
        : uiT('ui.first_run.start_game.pending', 'Откройте игру и остановитесь на экране с текстом.'),
    },
    {
      done: hasWindow,
      title: uiT('ui.first_run.refresh_window.title', 'Обновить окна'),
      body: hasWindow
        ? uiT('ui.first_run.refresh_window.done', 'Найдено окно для проверки.')
        : uiT('ui.first_run.refresh_window.pending', 'Вернитесь на страницу плагина и нажмите "Обновить окна".'),
    },
    {
      done: hasConfirmedWindow,
      title: uiT('ui.first_run.select_window.title', 'Выбрать окно игры'),
      body: hasConfirmedWindow
        ? uiT('ui.first_run.select_window.done', 'Окно распознавания подтверждено.')
        : uiT('ui.first_run.select_window.pending', 'Если окно не выбрано автоматически, выберите окно игры вручную.'),
    },
    {
      done: hasLine,
      title: uiT('ui.first_run.recognize.title', 'Начать распознавание'),
      body: hasLine
        ? uiT('ui.first_run.recognize.done', 'Реплика прочитана.')
        : uiT('ui.first_run.recognize.pending', 'Начните автоматическое распознавание или продвиньтесь к следующей реплике в игре.'),
    },
  ];
}

function renderFirstRunGuideLegacy(status = {}) {
  const node = document.getElementById('firstRunGuide');
  const stepsNode = document.getElementById('firstRunSteps');
  if (!node || !stepsNode) {
    return;
  }
  const steps = buildFirstRunSteps(status);
  const allDone = steps.every((step) => step.done);
  const readyToStart = steps.slice(0, 3).every((step) => step.done);
  const advancedSettings = document.getElementById('advancedSettings');
  const advancedOpen = Boolean(advancedSettings && advancedSettings.classList.contains('open'));
  const completedOrReady = allDone || readyToStart;
  const shouldHide = advancedOpen || completedOrReady;
  node.hidden = shouldHide;
  if (completedOrReady) {
    stepsNode.replaceChildren();
    document.body.classList.remove('onboarding-active');
    const onboardingView = document.getElementById('onboardingView');
    if (onboardingView) { onboardingView.hidden = true; }
    return;
  }
  if (advancedOpen) {
    return;
  }
  const firstIncompleteIndex = steps.findIndex((step) => !step.done);
  stepsNode.innerHTML = steps.map((step, index) => {
    const stateClass = step.done ? 'done' : (index === firstIncompleteIndex ? 'active' : 'pending');
    const marker = step.done ? uiT('ui.first_run.done_marker', 'Готово') : String(index + 1);
    return `
      <article class="first-run-step ${stateClass}">
        <span class="first-run-step-marker">${escapeHtml(marker)}</span>
        <div>
          <h3>${escapeHtml(step.title)}</h3>
          <p>${escapeHtml(step.body)}</p>
        </div>
      </article>
    `;
  }).join('');

  const onboardingSteps = document.getElementById('onboardingSteps');
  const onboardingActions = document.getElementById('onboardingActions');
  if (onboardingSteps) {
    onboardingSteps.innerHTML = stepsNode.innerHTML;
  }
  if (onboardingActions) {
    const firstIncomplete = steps[firstIncompleteIndex];
    const actions = [];
    if (!steps[2].done) {
      actions.push(`<button class="primary" data-first-run-action="select_ocr_window">${escapeHtml(primaryActionLabel('select_ocr_window'))}</button>`);
      actions.push(`<button class="secondary" data-first-run-action="refresh_ocr_windows">${escapeHtml(primaryActionLabel('refresh_ocr_windows'))}</button>`);
    }
    if (!steps[3].done && steps[2].done) {
      actions.push(`<button class="primary" data-first-run-action="choice_advisor">${escapeHtml(primaryActionLabel('start_recognition'))}</button>`);
      actions.push(`<button class="secondary" data-first-run-action="refresh_all">${escapeHtml(primaryActionLabel('refresh_status'))}</button>`);
    }
    onboardingActions.innerHTML = actions.join('');
  }
}

function buildFirstRunSteps(status = {}) {
  const runtime = status.ocr_reader_runtime || {};
  const memoryRuntime = status.memory_reader_runtime || {};
  const snapshotWindows = latestOcrWindowSnapshot && Array.isArray(latestOcrWindowSnapshot.windows)
    ? latestOcrWindowSnapshot.windows
    : [];
  const availableGameIds = Array.isArray(status.available_game_ids) ? status.available_game_ids : [];
  const detail = textValue(runtime.target_selection_detail);
  const lastExcludeReason = textValue(runtime.last_exclude_reason);
  const rapidocr = status.rapidocr || {};
  const dxcam = status.dxcam || {};
  const dxcamSupported = Boolean(dxcam.install_supported) && Boolean(dxcam.can_install);
  const selectedCaptureBackend = textValue(
    status.ocr_capture_backend_selection
    || runtime.capture_backend_kind
    || 'auto',
  );
  const dxcamRequired = requiresDxcamBackend(selectedCaptureBackend);
  const rapidocrModelsMissing = hasMissingRapidOcrModelFiles(rapidocr);
  const rapidocrUsable = isRapidOcrUsable(rapidocr);
  // Only route to the download CTA when the backend confirms it CAN run the
  // download. `can_download_models` is the same signal renderRapidOcr uses
  // to show/hide rapidocrModelsDownloadBtn, so the tutorial CTA stays in
  // sync with the visible button — without this, an env where the backend
  // gates download (e.g. permanent network block) would still hand the
  // user a "Download Now" CTA that points at a hidden button.
  const rapidocrModelsDownloadable = rapidocrModelsMissing && Boolean(rapidocr.can_download_models);
  // Route the install_ocr CTA to RapidOCR models/download state only.
  let ocrInstallAction;
  if (rapidocrModelsDownloadable) {
    ocrInstallAction = 'download_rapidocr_models';
  } else if (rapidocrModelsMissing) {
    ocrInstallAction = 'show_rapidocr_models_guide';
  } else {
    ocrInstallAction = null;
  }
  const ocrReady = Boolean(
    rapidocrUsable
    || (!rapidocrModelsMissing && rapidocr.detail === 'installed')
  );
  const captureReady = Boolean(!dxcamSupported || !dxcamRequired || dxcam.installed);
  const hasGame = Boolean(
    textValue(status.active_session_id)
    || availableGameIds.length
    || Number(runtime.pid || 0)
    || textValue(runtime.process_name)
    || textValue(runtime.window_title)
    || Number(memoryRuntime.pid || 0)
    || textValue(memoryRuntime.process_name)
  );
  const hasWindow = Boolean(
    textValue(runtime.effective_window_key)
    || Number(runtime.candidate_count || 0) > 0
    || snapshotWindows.length > 0
  );
  const hasConfirmedWindow = Boolean(
    textValue(runtime.effective_window_key)
    && detail !== 'no_eligible_window'
    && detail !== 'memory_reader_window_minimized'
    && lastExcludeReason !== 'excluded_minimized_window'
  );
  const processName = textValue(runtime.effective_process_name) || textValue(runtime.process_name);
  const hasProfile = ['bucket_exact', 'bucket_aspect_nearest', 'process_fallback']
    .includes(textValue(runtime.capture_profile_match_source));
  const { observedText, stableText, effectiveText } = getCurrentLineTexts(status);
  const hasLine = Boolean(effectiveText || stableText || observedText);
  const steps = [];

  if (!ocrReady) {
    let body;
    if (ocrInstallAction === 'download_rapidocr_models') {
      const sizeMb = (Number(rapidocr.missing_model_total_size || 0) / (1024 * 1024)).toFixed(1);
      body = uiTf(
        'ui.first_run.install_ocr.pending_models', 'Выбранные языковые модели ({lang} + {version}) не скачаны. Нажмите «Скачать модели сейчас», чтобы получить ~{size} МБ из ModelScope.',
        {
          lang: rapidocr.lang_type || 'ch',
          version: rapidocr.ocr_version || 'PP-OCRv4',
          size: sizeMb,
        },
      );
    } else if (rapidocrModelsMissing) {
      // Models missing but backend says auto-download isn't available — point
      // user at the manual recovery path (the RapidOCR banner has the source
      // URL + cache directory + manual-fallback hint already visible).
      body = uiTf(
        'ui.first_run.install_ocr.pending_models_manual', 'Выбранные языковые модели ({lang} + {version}) не скачаны. Следуйте баннеру RapidOCR, скачайте модели из доступного источника, поместите их в целевую папку и обновите статус.',
        {
          lang: rapidocr.lang_type || 'ch',
          version: rapidocr.ocr_version || 'PP-OCRv4',
        },
      );
    } else {
      body = uiT('ui.first_run.install_ocr.pending', 'RapidOCR недоступен. Используйте упакованную сборку или из исходников выполните `uv sync --group galgame` и перезапустите.');
    }
    steps.push({
      key: 'install_ocr',
      done: false,
      installAction: ocrInstallAction,
      title: uiT('ui.first_run.install_ocr.title', 'Модели OCR'),
      body,
    });
  }
  if (!captureReady) {
    steps.push({
      key: 'install_capture',
      done: false,
      title: uiT('ui.first_run.install_capture.title', 'Установка инструмента захвата'),
      body: uiT('ui.first_run.install_capture.pending', 'Перейдите в панель «Установка зависимостей» и установите DXcam.'),
      installAction: dxcamRequired && !dxcam.installed ? 'install_dxcam' : null,
    });
  }

  steps.push(
    {
      key: 'start_game',
      done: hasGame,
      title: uiT('ui.first_run.start_game.title', 'Запустить или восстановить игру'),
      body: hasGame
        ? uiT('ui.first_run.start_game.done', 'Статус игры обнаружен.')
        : uiT('ui.first_run.start_game.pending', 'Откройте игру и остановитесь на экране с текстом.'),
    },
    {
      key: 'refresh_window',
      done: hasWindow,
      title: uiT('ui.first_run.refresh_window.title', 'Обновить окна'),
      body: hasWindow
        ? uiT('ui.first_run.refresh_window.done', 'Найдено окно для проверки.')
        : uiT('ui.first_run.refresh_window.pending', 'Вернитесь на страницу плагина и нажмите "Обновить окна".'),
    },
    {
      key: 'select_window',
      done: hasConfirmedWindow,
      title: uiT('ui.first_run.select_window.title', 'Выбрать окно игры'),
      body: hasConfirmedWindow
        ? uiT('ui.first_run.select_window.done', 'Окно распознавания подтверждено.')
        : uiT('ui.first_run.select_window.pending', 'Если окно не выбрано автоматически, выберите окно игры вручную.'),
    },
  );

  if (hasConfirmedWindow && processName && !hasProfile) {
    steps.push({
      key: 'calibrate',
      done: false,
      title: uiT('ui.first_run.calibrate.title', 'Калибровка области захвата'),
      body: uiT('ui.first_run.calibrate.pending', 'Откройте «Расширенные настройки» и задайте область обрезки в калибровке захвата OCR.'),
    });
  }

  steps.push({
    key: 'recognize',
    done: hasLine,
    title: uiT('ui.first_run.recognize.title', 'Начать распознавание'),
    body: hasLine
      ? uiT('ui.first_run.recognize.done', 'Реплика прочитана.')
      : uiT('ui.first_run.recognize.pending', 'Начните автоматическое распознавание или продвиньтесь к следующей реплике в игре.'),
  });

  return steps;
}

function buildFirstRunActions(steps, firstIncompleteIndex) {
  if (firstIncompleteIndex < 0) {
    return '';
  }
  const firstIncomplete = steps[firstIncompleteIndex] || {};
  const actions = [];

  if (firstIncomplete.key === 'install_ocr') {
    const installAction = firstIncomplete.installAction;
    if (installAction) {
      const actionLabel = installAction === 'download_rapidocr_models'
        ? uiT('ui.first_run.action.download_rapidocr_models', 'Скачать модели сейчас')
        : uiT('ui.first_run.action.show_rapidocr_models_guide', 'Открыть ручную инструкцию');
      actions.push(`<button class="primary" data-first-run-action="${escapeHtml(installAction)}">${escapeHtml(actionLabel)}</button>`);
    }
    actions.push(`<button class="secondary" data-first-run-action="refresh_all">${escapeHtml(uiT('ui.first_run.action.refresh_all', primaryActionLabel('refresh_status')))}</button>`);
  } else if (firstIncomplete.key === 'install_capture') {
    if (firstIncomplete.installAction === 'install_dxcam') {
      const actionLabel = hasInstallFlow('dxcam')
        ? uiT('ui.first_run.action.install_dxcam', primaryActionLabel('install_dxcam'))
        : uiT('ui.first_run.action.show_dxcam_fix_guide', 'Открыть инструкцию по исправлению DXcam');
      actions.push(`<button class="primary" data-first-run-action="install_dxcam">${escapeHtml(actionLabel)}</button>`);
    }
    actions.push(`<button class="secondary" data-first-run-action="refresh_all">${escapeHtml(uiT('ui.first_run.action.refresh_all', primaryActionLabel('refresh_status')))}</button>`);
  } else if (firstIncomplete.key === 'start_game' || firstIncomplete.key === 'refresh_window') {
    actions.push(`<button class="secondary" data-first-run-action="refresh_all">${escapeHtml(uiT('ui.first_run.action.refresh_all', primaryActionLabel('refresh_status')))}</button>`);
  } else if (firstIncomplete.key === 'select_window') {
    actions.push(`<button class="primary" data-first-run-action="select_ocr_window">${escapeHtml(uiT('ui.first_run.action.select_window', primaryActionLabel('select_ocr_window')))}</button>`);
    actions.push(`<button class="secondary" data-first-run-action="refresh_ocr_windows">${escapeHtml(primaryActionLabel('refresh_ocr_windows'))}</button>`);
  } else if (firstIncomplete.key === 'calibrate') {
    actions.push(`<button class="primary" data-first-run-action="recalibrate_ocr">${escapeHtml(uiT('ui.first_run.action.auto_calibrate', primaryActionLabel('recalibrate_ocr')))}</button>`);
    actions.push(`<button class="secondary" data-first-run-action="refresh_all">${escapeHtml(uiT('ui.first_run.action.refresh_all', primaryActionLabel('refresh_status')))}</button>`);
  } else if (firstIncomplete.key === 'recognize') {
    actions.push(`<button class="primary" data-first-run-action="choice_advisor">${escapeHtml(uiT('ui.first_run.action.start_recognition', primaryActionLabel('start_recognition')))}</button>`);
    actions.push(`<button class="secondary" data-first-run-action="refresh_all">${escapeHtml(uiT('ui.first_run.action.refresh_all', primaryActionLabel('refresh_status')))}</button>`);
  }
  return actions.join('');
}

function saveTutorialProgressDeduped(key, partial) {
  if (tutorialProgressPendingSaveKeys.has(key)) {
    return null;
  }
  tutorialProgressPendingSaveKeys.add(key);
  const save = saveTutorialProgress(partial);
  save.then(
    () => {
      tutorialProgressPendingSaveKeys.delete(key);
    },
    () => {
      tutorialProgressPendingSaveKeys.delete(key);
    },
  );
  return save;
}

function renderFirstRunGuide(status = {}) {
  const node = document.getElementById('firstRunGuide');
  const stepsNode = document.getElementById('firstRunSteps');
  if (!node || !stepsNode) {
    return;
  }
  const steps = buildFirstRunSteps(status);
  const allDone = steps.every((step) => step.done);
  const gameStepIndex = steps.findIndex((step) => step.key === 'start_game');
  const readyThreshold = gameStepIndex >= 0
    ? Math.min(steps.length, gameStepIndex + 2)
    : Math.min(3, steps.length);
  const readyToStart = readyThreshold > 0 && steps.slice(0, readyThreshold).every((step) => step.done);
  const advancedSettings = document.getElementById('advancedSettings');
  const advancedOpen = Boolean(advancedSettings && advancedSettings.classList.contains('open'));
  const shouldHideOnboarding = advancedOpen || allDone || readyToStart;
  const shouldHideMainGuide = advancedOpen || allDone;
  const onboardingView = document.getElementById('onboardingView');

  if (onboardingView) {
    if (shouldHideOnboarding && !forceShowOnboarding) {
      onboardingView.hidden = true;
      onboardingDismissed = true;
      forceShowOnboarding = false;
      document.body.classList.remove('onboarding-active');
    } else if (!onboardingDismissed && !readSkipOnboarding()) {
      onboardingView.hidden = false;
      document.body.classList.add('onboarding-active');
    }
  }

  if (shouldHideMainGuide && !forceShowOnboarding) {
    node.hidden = true;
    stepsNode.replaceChildren();
    document.body.classList.remove('onboarding-active');
    if (onboardingView) { onboardingView.hidden = true; }
    if (allDone && !latestTutorialProgress?.completed) {
      const completedAt = Date.now() / 1000;
      saveTutorialProgressDeduped('completed', { completed: true, completed_at: completedAt })
        ?.then(() => {
          latestTutorialProgress = {
            ...(latestTutorialProgress || {}),
            completed: true,
            completed_at: completedAt,
          };
        })
        .catch(() => {});
    }
    return;
  }
  if (advancedOpen && !forceShowOnboarding) {
    return;
  }

  const firstIncompleteIndex = steps.findIndex((step) => !step.done);
  if (firstIncompleteIndex >= 0 && firstIncompleteIndex !== lastSavedStepIndex) {
    saveTutorialProgressDeduped(`last_step_index:${firstIncompleteIndex}`, { last_step_index: firstIncompleteIndex })
      ?.then(() => {
        lastSavedStepIndex = firstIncompleteIndex;
      })
      .catch(() => {});
  }
  const html = steps.map((step, index) => {
    const stateClass = step.done ? 'done' : (index === firstIncompleteIndex ? 'active' : 'pending');
    const marker = step.done ? uiT('ui.first_run.done_marker', 'Готово') : String(index + 1);
    return `
      <article class="first-run-step ${stateClass}">
        <span class="first-run-step-marker">${escapeHtml(marker)}</span>
        <div>
          <h3>${escapeHtml(step.title)}</h3>
          <p>${escapeHtml(step.body)}</p>
        </div>
      </article>
    `;
  }).join('');

  stepsNode.innerHTML = html;
  node.hidden = false;

  const onboardingSteps = document.getElementById('onboardingSteps');
  const onboardingActions = document.getElementById('onboardingActions');
  if (onboardingSteps) {
    onboardingSteps.innerHTML = html;
  }
  if (onboardingActions) {
    onboardingActions.innerHTML = buildFirstRunActions(steps, firstIncompleteIndex);
  }
}

function renderCurrentLineOverview(status = {}) {
  const node = document.getElementById('currentLineOverview');
  if (!node) {
    return;
  }
  const runtime = status.ocr_reader_runtime || {};
  const title = document.getElementById('currentLineOverviewTitle');
  const statusChip = document.getElementById('currentLineOverviewStatus');
  const hint = document.getElementById('currentLineOverviewHint');
  const grid = document.getElementById('currentLineOverviewGrid');
  const { rawText, observedText, stableText } = getCurrentLineTexts(status);
  const displayStable = stableText;
  const observedKey = compactLineText(observedText);
  const stableKey = compactLineText(displayStable);
  const hasMismatch = Boolean(observedKey && observedKey !== stableKey);
  const blockReason = formatStableBlockReason(runtime.stable_ocr_block_reason);
  const repeatCount = Number(runtime.stable_ocr_repeat_count || 0);

  node.classList.toggle('waiting', !rawText && !observedText && !displayStable);
  statusChip.className = 'status-chip';
  if (hasMismatch) {
    title.textContent = uiT('ui.current_line.new_text_title', 'New text observed');
    statusChip.textContent = uiT('ui.current_line.confirming_status', 'Подтверждение');
    statusChip.classList.add('warning');
    hint.textContent = blockReason || (repeatCount
      ? uiTf('ui.current_line.confirming_repeat_hint', 'Проверяется, та же ли это реплика; подряд обнаружено {count} раз.', { count: repeatCount })
      : uiT('ui.current_line.confirming_hint', 'Проверяется, та же ли это реплика.'));
  } else if (displayStable) {
    title.textContent = uiT('ui.current_line.confirmed_title', 'Текущая реплика подтверждена');
    statusChip.textContent = uiT('ui.current_line.confirmed_status', 'Подтверждено');
    statusChip.classList.add('active');
    hint.textContent = uiT('ui.current_line.confirmed_hint', 'Эта реплика вошла в официальный контекст; дальнейшие подсказки будут обновляться на ее основе.');
  } else if (rawText || observedText) {
    title.textContent = uiT('ui.current_line.filtering_title', 'Фильтрация результата распознавания');
    statusChip.textContent = uiT('ui.current_line.filtering_status', 'Фильтрация');
    statusChip.classList.add('warning');
    hint.textContent = blockReason || uiT('ui.current_line.filtering_hint', 'Результат распознавания текста есть, но он еще не записан как официальная реплика.');
  } else {
    title.textContent = uiT('ui.current_line.waiting_result', 'Ожидание результата распознавания');
    statusChip.textContent = uiT('ui.current_line.waiting_refresh', 'Ожидание обновления');
    hint.textContent = buildOcrMissingLineDiagnostic(status);
  }

  const rows = [
    {
      label: uiT('ui.current_line.raw_ocr_label', 'Последний raw OCR'),
      value: rawText,
      empty: uiT('ui.current_line.no_raw_ocr', 'raw OCR пока нет'),
    },
    {
      label: uiT('ui.current_line.observed_label', 'Новая наблюдаемая реплика-кандидат'),
      value: observedText,
      empty: uiT('ui.current_line.no_observed', 'Реплики-кандидата пока нет'),
    },
    {
      label: uiT('ui.current_line.stable_label', 'Подтвержденная реплика'),
      value: displayStable,
      empty: uiT('ui.current_line.no_stable', 'Подтвержденной реплики пока нет'),
    },
  ];

  grid.innerHTML = rows.map((row) => `
    <article class="current-line-item${row.value ? '' : ' empty'}">
      <p class="list-kicker">${escapeHtml(row.label)}</p>
      <p>${escapeHtml(row.value || row.empty)}</p>
    </article>
  `).join('');

  const effectiveEl = document.getElementById('currentLineEffectiveText');
  const observedCollapse = document.getElementById('observedLinesCollapse');
  const observedContent = document.getElementById('observedLinesContent');

  if (effectiveEl) {
    const effectiveText = displayStable || observedText || rawText;
    if (effectiveText) {
      effectiveEl.textContent = effectiveText;
      effectiveEl.hidden = false;
    } else {
      effectiveEl.hidden = true;
    }
  }

  if (observedCollapse && observedContent) {
    const hasObserved = observedText && observedText !== displayStable;
    const hasRaw = rawText && rawText !== observedText && rawText !== displayStable;
    const observedLines = [];
    if (hasObserved) { observedLines.push(observedText); }
    if (hasRaw) { observedLines.push(rawText); }

    if (observedLines.length > 0 && displayStable) {
      observedCollapse.hidden = false;
      observedContent.innerHTML = observedLines.map((text) =>
        `<div class="observed-line-item">${escapeHtml(text)}</div>`
      ).join('');
    } else {
      observedCollapse.hidden = true;
    }
  }
}

function pipelineStateLabel(state) {
  const mapping = {
    ok: uiT('ui.pipeline_state.ok', 'Норма'),
    info: uiT('ui.pipeline_state.info', 'Ожидание'),
    warning: uiT('ui.pipeline_state.warning', 'Внимание'),
    error: uiT('ui.pipeline_state.error', 'Ошибка'),
  };
  return uiDynamicT('ui.pipeline_state', state, mapping[state] || mapping.info);
}

function buildOcrPipelineSteps(status = {}) {
  const runtime = status.ocr_reader_runtime || {};
  const rapidocr = status.rapidocr || {};
  const detail = textValue(runtime.target_selection_detail);
  const contextState = textValue(status.ocr_context_state || runtime.ocr_context_state);
  const lastExcludeReason = textValue(runtime.last_exclude_reason);
  const lastCaptureError = textValue(runtime.last_capture_error);
  const lastRejectedReason = textValue(runtime.last_rejected_ocr_reason);
  const { rawText, observedText, stableText } = getCurrentLineTexts(status);
  const displayStable = stableText;
  const observedKey = compactLineText(observedText);
  const stableKey = compactLineText(displayStable);
  const hasObservedMismatch = Boolean(observedKey && observedKey !== stableKey);
  const blockReason = formatStableBlockReason(runtime.stable_ocr_block_reason);
  const tickBlockReason = textValue(status.ocr_tick_block_reason || runtime.ocr_tick_block_reason);
  const emitBlockReason = textValue(status.ocr_emit_block_reason || runtime.ocr_emit_block_reason);
  const formattedTickBlockReason = formatOcrTickBlockReason(tickBlockReason);
  const formattedEmitBlockReason = formatOcrEmitBlockReason(emitBlockReason);
  const captureBackend = textValue(runtime.capture_backend_kind || status.ocr_capture_backend_selection || 'auto');
  const ocrBackend = textValue(runtime.backend_kind || status.ocr_backend_selection || 'auto');

  let windowStep = {
    key: 'window',
    state: 'info',
    title: uiT('ui.pipeline.window.waiting_title', 'Ожидание окна игры'),
    body: uiT('ui.pipeline.window.waiting_body', 'Ожидание, пока целевое окно станет распознаваемым.'),
    meta: detail ? formatOcrWindowSelectionDetail(detail) : '',
  };
  if (detail === 'memory_reader_window_minimized' || lastExcludeReason === 'excluded_minimized_window') {
    windowStep = {
      key: 'window',
      state: 'warning',
      title: uiT('ui.pipeline.window.minimized_title', 'Окно игры свернуто'),
      body: uiT('ui.pipeline.window.needs_attention_body', 'Стадия окна требует внимания.'),
      meta: formatOcrWindowReason(lastExcludeReason || 'excluded_minimized_window'),
    };
  } else if (textValue(runtime.effective_window_key)) {
    windowStep = {
      key: 'window',
      state: 'ok',
      title: uiT('ui.pipeline.window.confirmed_title', 'Окно игры подтверждено'),
      body: uiT('ui.pipeline.window.ok_body', 'Стадия окна в норме.'),
      meta: runtime.target_is_foreground
        ? uiT('ui.pipeline.window.foreground_meta', 'Окно на переднем плане')
        : uiT('ui.pipeline.window.not_foreground_meta', 'Окно не на переднем плане'),
    };
  } else if (Number(runtime.candidate_count || 0) > 0) {
    windowStep = {
      key: 'window',
      state: 'info',
      title: uiT('ui.pipeline.window.candidate_title', 'Найдено окно-кандидат'),
      body: uiT('ui.pipeline.window.waiting_confirm_body', 'Стадия окна ожидает подтверждения.'),
      meta: uiT('ui.pipeline.window.manual_if_needed_meta', 'При необходимости выберите вручную'),
    };
  } else if (detail === 'no_eligible_window' || Object.prototype.hasOwnProperty.call(runtime, 'candidate_count')) {
    windowStep = {
      key: 'window',
      state: 'warning',
      title: uiT('ui.pipeline.window.none_title', 'Нет распознаваемого окна'),
      body: uiT('ui.pipeline.window.needs_attention_body', 'Стадия окна требует внимания.'),
      meta: formatOcrWindowSelectionDetail(detail),
    };
  }

  let captureStep = {
    key: 'capture',
    state: 'info',
    title: uiT('ui.pipeline.capture.waiting_title', 'Ожидание захвата'),
    body: uiT('ui.pipeline.capture.waiting_body', 'Стадия захвата ожидает подтверждения окна.'),
    meta: captureBackend,
  };
  if (contextState === 'capture_failed' || lastCaptureError) {
    captureStep = {
      key: 'capture',
      state: 'error',
      title: uiT('ui.pipeline.capture.failed_title', 'Захват не удался'),
      body: uiT('ui.pipeline.stage_error_body', 'На стадии есть ошибка; используйте диагностику выполнения для действий.'),
      meta: captureBackend,
    };
  } else if (runtime.stale_capture_backend) {
    captureStep = {
      key: 'capture',
      state: 'warning',
      title: uiT('ui.pipeline.capture.stale_title', 'Изображение захвата не обновляется'),
      body: uiT('ui.pipeline.capture.needs_attention_body', 'Стадия захвата требует внимания.'),
      meta: `${captureBackend}${runtime.consecutive_same_capture_frames ? ` | ${uiTf('ui.pipeline.capture.same_frames_meta', '{count} одинаковых кадров подряд', { count: runtime.consecutive_same_capture_frames })}` : ''}`,
    };
  } else if (runtime.last_capture_completed_at || runtime.last_capture_image_hash || runtime.capture_backend_kind) {
    captureStep = {
      key: 'capture',
      state: 'ok',
      title: uiT('ui.pipeline.capture.available_title', 'Бэкенд захвата доступен'),
      body: uiT('ui.pipeline.capture.ok_body', 'Стадия захвата в норме.'),
      meta: captureBackend,
    };
  }

  let ocrStep = {
    key: 'ocr',
    state: 'info',
    title: uiT('ui.pipeline.ocr.waiting_title', 'Ожидание распознавания текста'),
    body: uiT('ui.pipeline.ocr.waiting_body', 'Стадия распознавания ожидает входной захват.'),
    meta: ocrBackend,
  };
  if (!status.ocr_reader_enabled) {
    ocrStep = {
      key: 'ocr',
      state: 'warning',
      title: uiT('ui.pipeline.ocr.disabled_title', 'OCR Reader отключен'),
      body: uiT('ui.pipeline.ocr.disabled_body', 'Стадия распознавания отключена.'),
      meta: ocrBackend,
    };
  } else if (tickBlockReason) {
    ocrStep = {
      key: 'ocr',
      state: ['ocr_reader_unavailable', 'ocr_reader_not_allowed', 'reader_mode_memory_only'].includes(tickBlockReason)
        ? 'warning'
        : 'info',
      title: uiT('ui.pipeline.ocr.tick_blocked_title', 'OCR-опрос еще не выполнялся'),
      body: formattedTickBlockReason || uiT('ui.pipeline.ocr.tick_waiting_body', 'Стадия опроса ожидает выполнения условий.'),
      meta: ocrBackend,
    };
  } else if (runtime.backend_detail === 'backend_unavailable' || runtime.detail === 'backend_unavailable') {
    ocrStep = {
      key: 'ocr',
      state: 'error',
      title: uiT('ui.pipeline.ocr.backend_unavailable_title', 'OCR-бэкенд недоступен'),
      body: uiT('ui.pipeline.ocr.error_body', 'На стадии распознавания есть ошибка; используйте диагностику выполнения для действий.'),
      meta: ocrBackend,
    };
  } else if (runtime.detail === 'self_ui_guard_blocked' || lastRejectedReason) {
    ocrStep = {
      key: 'ocr',
      state: 'warning',
      title: uiT('ui.pipeline.ocr.rejected_title', 'OCR отклонил неигровой текст'),
      body: uiT('ui.pipeline.ocr.no_write_body', 'Распознавание выполнено, но новая реплика не записана.'),
      meta: lastRejectedReason || ocrBackend,
    };
  } else if (emitBlockReason) {
    ocrStep = {
      key: 'ocr',
      state: emitBlockReason === 'screen_classification_skipped_dialogue' ? 'warning' : 'info',
      title: uiT('ui.pipeline.ocr.executed_title', 'OCR выполнен'),
      body: formattedEmitBlockReason || uiT('ui.pipeline.ocr.executed_no_write_body', 'Распознавание выполнено, но новая реплика не записана.'),
      meta: ocrBackend,
    };
  } else if (runtime.backend_kind || rawText || observedText || displayStable) {
    ocrStep = {
      key: 'ocr',
      state: 'ok',
      title: uiT('ui.pipeline.ocr.available_title', 'Распознавание текста доступно'),
      body: uiT('ui.pipeline.ocr.ok_body', 'Стадия распознавания в норме.'),
      meta: ocrBackend,
    };
  } else if (!rapidocr.installed) {
    ocrStep = {
      key: 'ocr',
      state: 'warning',
      title: uiT('ui.pipeline.ocr.missing_components_title', 'Компоненты OCR могут отсутствовать'),
      body: uiT('ui.pipeline.ocr.needs_attention_body', 'Стадия распознавания требует внимания.'),
      meta: ocrBackend,
    };
  }

  const observedStep = observedText
    ? {
      key: 'observed',
      state: hasObservedMismatch ? 'warning' : 'ok',
      title: hasObservedMismatch
        ? uiT('ui.pipeline.observed.confirming_title', 'Подтверждение реплики-кандидата')
        : uiT('ui.pipeline.observed.read_title', 'Реплика-кандидат прочитана'),
      body: hasObservedMismatch
        ? uiT('ui.pipeline.observed.confirming_body', 'Реплика-кандидат ожидает стабильного подтверждения.')
        : uiT('ui.pipeline.observed.ok_body', 'Чтение реплики-кандидата в норме.'),
      meta: hasObservedMismatch
        ? (formattedEmitBlockReason || blockReason || uiT('ui.pipeline.observed.waiting_stable_meta', 'Ожидание стабильного подтверждения'))
        : uiT('ui.pipeline.observed.same_as_stable_meta', 'Кандидат совпадает с подтвержденной репликой'),
    }
    : {
      key: 'observed',
      state: rawText ? 'info' : 'warning',
      title: rawText
        ? uiT('ui.pipeline.observed.filtering_raw_title', 'Фильтрация raw OCR')
        : uiT('ui.pipeline.observed.no_candidate_title', 'Реплики-кандидата пока нет'),
      body: rawText
        ? uiT('ui.pipeline.observed.filtering_body', 'Стадия кандидата выполняет фильтрацию.')
        : uiT('ui.pipeline.observed.waiting_text_body', 'Стадия кандидата ожидает допустимый текст.'),
      meta: formattedEmitBlockReason || blockReason || formattedTickBlockReason || '',
    };

  const stableStep = displayStable
    ? {
      key: 'stable',
      state: 'ok',
      title: uiT('ui.pipeline.stable.confirmed_title', 'Подтвержденная реплика'),
      body: uiT('ui.pipeline.stable.ok_body', 'Стадия подтверждения в норме.'),
      meta: status.effective_current_line?.source || runtime.last_stable_line?.source || '',
    }
    : {
      key: 'stable',
      state: observedText ? 'warning' : 'info',
      title: observedText
        ? uiT('ui.pipeline.stable.waiting_title', 'Ожидание стабильного подтверждения')
        : uiT('ui.pipeline.stable.no_stable_title', 'Подтвержденной реплики пока нет'),
      body: observedText
        ? uiT('ui.pipeline.stable.waiting_body', 'Стадия подтверждения ожидает стабильности.')
        : uiT('ui.pipeline.stable.waiting_candidate_body', 'Стадия подтверждения ожидает реплику-кандидат.'),
      meta: formattedEmitBlockReason || blockReason || formattedTickBlockReason || '',
    };

  let agentStep = {
    key: 'agent',
    state: 'info',
    title: uiT('ui.pipeline.agent.waiting_title', 'Ожидание статуса Agent'),
    body: uiT('ui.pipeline.agent.waiting_body', 'Agent решает, выполнять ли автопродвижение, исходя из режима.'),
    meta: status.mode || '',
  };
  if (status.agent_user_status === 'error') {
    agentStep = {
      key: 'agent',
      state: 'error',
      title: uiT('ui.pipeline.agent.error_title', 'Ошибка Agent'),
      body: status.agent_reason || status.agent_diagnostic || uiT('ui.pipeline.agent.error_body', 'Agent вернул статус ошибки.'),
      meta: status.agent_pause_kind || '',
    };
  } else if (status.agent_pause_kind === 'window_not_foreground' || status.agent_user_status === 'paused_window_not_foreground') {
    agentStep = {
      key: 'agent',
      state: 'warning',
      title: uiT('ui.pipeline.agent.not_foreground_title', 'Игра не на переднем плане'),
      body: status.agent_pause_message || uiT('ui.pipeline.agent.not_foreground_body', 'Автопродвижение приостановлено. Вернитесь в игру для продолжения.'),
      meta: agentUserStatusLabel(status.agent_user_status, status.agent_user_status || ''),
    };
  } else if (status.agent_pause_kind === 'screen_safety' || status.agent_user_status === 'screen_safety_pause') {
    agentStep = {
      key: 'agent',
      state: 'warning',
      title: uiT('ui.pipeline.agent.safety_pause_title', 'Безопасная пауза'),
      body: status.agent_pause_message || uiT('ui.pipeline.agent.safety_pause_body', 'Текущий экран не подходит для автопродвижения.'),
      meta: agentUserStatusLabel(status.agent_user_status, status.agent_user_status || ''),
    };
  } else if (status.agent_pause_kind === 'read_only' || status.agent_user_status === 'read_only') {
    agentStep = {
      key: 'agent',
      state: 'info',
      title: uiT('ui.pipeline.agent.read_only_title', 'Режим сопровождения'),
      body: uiT('ui.pipeline.agent.read_only_body', 'Реплики и подсказки показываются, но автоматические клики отключены.'),
      meta: agentUserStatusLabel(status.agent_user_status, ''),
    };
  } else if (status.agent_user_status || status.agent_status) {
    agentStep = {
      key: 'agent',
      state: 'ok',
      title: uiT('ui.pipeline.agent.ok_title', 'Статус Agent в норме'),
      body: status.agent_activity || status.agent_reason || uiT('ui.pipeline.agent.ok_body', 'Работает в текущем режиме.'),
      meta: agentUserStatusLabel(status.agent_user_status, status.agent_user_status || status.agent_status || ''),
    };
  }

  return [windowStep, captureStep, ocrStep, observedStep, stableStep, agentStep];
}

function renderOcrPipelinePanel(status = {}) {
  const node = document.getElementById('ocrPipelinePanel');
  const stepsNode = document.getElementById('ocrPipelineSteps');
  const summaryNode = document.getElementById('ocrPipelineSummary');
  if (!node || !stepsNode || !summaryNode) {
    return;
  }
  const steps = buildOcrPipelineSteps(status);
  const worstState = steps.some((step) => step.state === 'error')
    ? 'error'
    : steps.some((step) => step.state === 'warning')
      ? 'warning'
      : steps.every((step) => step.state === 'ok')
        ? 'ok'
        : 'info';
  summaryNode.className = `status-chip ${worstState === 'ok' ? 'active' : worstState}`;
  summaryNode.textContent = worstState === 'ok'
    ? uiT('ui.ocr.pipeline.summary_ok', 'Цепочка в норме')
    : worstState === 'error'
      ? uiT('ui.ocr.pipeline.summary_error', 'Ошибка цепочки')
      : worstState === 'warning'
        ? uiT('ui.ocr.pipeline.summary_warning', 'Требуется внимание')
        : uiT('ui.ocr.pipeline.summary_waiting', 'Ожидание статуса');
  stepsNode.innerHTML = steps.map((step) => `
    <article class="ocr-pipeline-step ${escapeHtml(step.state)}">
      <span class="ocr-pipeline-dot">${escapeHtml(pipelineStateLabel(step.state))}</span>
      <div>
        <p class="list-kicker">${escapeHtml(step.key)}</p>
        <h3>${escapeHtml(step.title)}</h3>
        <p>${escapeHtml(step.body || '')}</p>
        ${step.meta ? `<p class="result-note">${escapeHtml(step.meta)}</p>` : ''}
      </div>
    </article>
  `).join('');
}

function installTaskDisplayState(kind) {
  const state = getInstallState(kind);
  const task = state && state.state ? state.state : {};
  if (state?.inProgress) {
    return {
      state: 'running',
      labelText: uiT('ui.install.summary.installing', 'Установка'),
      needsAttention: true,
    };
  }
  if (task.status === 'failed') {
    return {
      state: 'failed',
      labelText: uiT('ui.install.summary.failed', 'Установка не удалась'),
      needsAttention: true,
    };
  }
  if (task.status === 'completed') {
    return {
      state: 'installed',
      labelText: uiT('ui.install.summary.installed', 'Установлено'),
      needsAttention: false,
    };
  }
  return null;
}

function dependencySummaryItem(kind, status = {}) {
  const taskKind = kind === 'rapidocr' ? 'rapidocr_models' : kind;
  if (taskKind === 'textractor' || taskKind === 'rapidocr_models') {
    const taskState = installTaskDisplayState(taskKind);
    const rapidocr = kind === 'rapidocr' ? (status.rapidocr || {}) : {};
    const rapidocrModelsStillMissing = kind !== 'rapidocr'
      || rapidocr.detail === 'missing_model_files'
      || !rapidocr.installed;
    const taskCompletedButModelsMissing = kind === 'rapidocr'
      && taskState?.state === 'installed'
      && hasMissingRapidOcrModelFiles(rapidocr);
    if (taskState && rapidocrModelsStillMissing && !taskCompletedButModelsMissing) {
      const displayTaskState = kind === 'rapidocr' && taskState.state === 'running'
        ? {
            ...taskState,
            labelText: uiT('ui.install.rapidocr.download_models.running', 'Скачивание моделей в фоне...'),
            needsAttention: false,
          }
        : kind === 'rapidocr' && taskState.state === 'failed' && shouldOfferRapidOcrModelsDownload(rapidocr)
          ? {
              ...taskState,
              labelText: uiT('ui.install.rapidocr.download_models.retry', 'Повторить скачивание моделей'),
              needsAttention: true,
            }
          : taskState;
      return {
        kind,
        label: kind === 'rapidocr' ? 'RapidOCR' : getInstallConfig(taskKind).label,
        ...displayTaskState,
      };
    }
  }

  if (kind === 'rapidocr') {
    const rapidocr = status.rapidocr || {};
    const rapidocrModelsMissing = hasMissingRapidOcrModelFiles(rapidocr);
    if (!rapidocr.install_supported) {
      return { kind, label: 'RapidOCR', state: 'optional', labelText: uiT('ui.install.summary.platform_unsupported', 'Не поддерживается'), needsAttention: false };
    }
    if (rapidocrModelsMissing) {
      return { kind, label: 'RapidOCR', state: 'warning', labelText: uiT('ui.install.summary.models_missing', 'Нет моделей'), needsAttention: true };
    }
    if (isRapidOcrUsable(rapidocr)) {
      return { kind, label: 'RapidOCR', state: 'installed', labelText: uiT('ui.install.summary.ready', 'Готово'), needsAttention: false };
    }
    return { kind, label: 'RapidOCR', state: 'missing', labelText: uiT('ui.install.summary.not_found', 'Не найдено'), needsAttention: true };
  }

  if (kind === 'dxcam') {
    const dxcam = status.dxcam || {};
    const runtime = status.ocr_reader_runtime || {};
    const activeCaptureBackend = textValue(runtime.capture_backend_kind);
    const selectedCaptureBackend = textValue(status.ocr_capture_backend_selection || 'auto');
    const activeBackendLabel = activeCaptureBackend
      ? captureBackendLabel(activeCaptureBackend)
      : captureBackendLabel(selectedCaptureBackend);
    const label = uiT('ui.install.summary.capture_backend', 'Бэкенд захвата');
    if (!dxcam.install_supported) {
      return { kind, label, state: 'optional', labelText: activeBackendLabel, needsAttention: false };
    }
    if (activeCaptureBackend) {
      return { kind, label, state: 'installed', labelText: activeBackendLabel, needsAttention: false };
    }
    return { kind, label, state: 'warning', labelText: uiT('ui.install.capture_backend.waiting_active', 'Ожидание следующего OCR-захвата для подтверждения'), needsAttention: true };
  }

  const textractor = status.textractor || {};
  return textractor.installed
    ? { kind, label: 'Textractor', state: 'installed', labelText: uiT('ui.install.summary.installed', 'Установлено'), needsAttention: false }
    : { kind, label: 'Textractor', state: 'optional', labelText: uiT('ui.install.summary.missing_optional', 'Не установлено (необязательно)'), needsAttention: false };
}

function renderInstallCompactSummary(status = {}) {
  const summary = document.getElementById('installCompactSummary');
  if (!summary) {
    return;
  }
  const ocrItems = ['rapidocr', 'dxcam'].map((kind) => dependencySummaryItem(kind, status));
  const memoryItems = ['textractor'].map((kind) => dependencySummaryItem(kind, status));
  const renderGroup = (label, items) => `
    <span class="install-summary-group">
      <span class="install-summary-label">${escapeHtml(label)}</span>
      ${items.map((item) => `
        <span class="install-summary-chip ${escapeHtml(item.state || 'neutral')}">
          ${escapeHtml(item.label)} ${escapeHtml(item.labelText || item.label || '')}
        </span>
      `).join('')}
    </span>
  `;
  summary.innerHTML = [
    renderGroup('OCR', ocrItems),
    renderGroup(uiT('ui.install.summary.memory_group', 'Память'), memoryItems),
  ].join('');
}

function formatOcrTargetForUser(status = {}) {
  const runtime = status.ocr_reader_runtime || {};
  const processName = runtime.process_name || runtime.effective_process_name || '';
  const title = runtime.window_title || runtime.effective_window_title || '';
  const pid = Number(runtime.pid || 0);
  const parts = [];
  if (processName) {
    parts.push(processName);
  }
  if (title) {
    parts.push(title);
  }
  if (pid) {
    parts.push(`pid ${pid}`);
  }
  return parts.join(' / ');
}

function syncAgentResumeButton(status = {}) {
  const button = document.getElementById('standbyOffBtn');
  const userStatus = status.agent_user_status || '';
  const pauseKind = status.agent_pause_kind || '';
  button.disabled = false;
  if (status.agent_can_resume_by_button || userStatus === 'paused_by_user') {
    button.textContent = uiT('ui.button.standby_off', 'Возобновить');
    button.dataset.resumeAction = 'standby';
  } else if (pauseKind === 'window_not_foreground' || userStatus === 'paused_window_not_foreground') {
    button.textContent = uiT('ui.agent.resume.focus_game', 'Вернуться к окну игры');
    button.dataset.resumeAction = 'focus';
  } else if (pauseKind === 'read_only' || userStatus === 'read_only') {
    button.textContent = uiT('ui.agent.resume.read_only', 'Режим только чтения');
    button.dataset.resumeAction = 'read_only';
  } else {
    button.textContent = uiT('ui.button.standby_off', 'Возобновить');
    button.dataset.resumeAction = 'noop';
  }
}

function isSettingsControlElement(element) {
  return Boolean(element && SETTINGS_CONTROL_IDS.has(element.id || ''));
}

function shouldPreserveSettingsControls() {
  return settingsDirty || settingsSaveInFlight || isSettingsControlElement(document.activeElement);
}

function syncSettingsValue(id, value) {
  if (shouldPreserveSettingsControls()) {
    return;
  }
  const node = document.getElementById(id);
  if (node) {
    node.value = value;
  }
}

function syncSettingsChecked(id, checked) {
  if (shouldPreserveSettingsControls()) {
    return;
  }
  const node = document.getElementById(id);
  if (node) {
    node.checked = Boolean(checked);
  }
}

function renderAgentUserNotice(status = {}) {
  const node = document.getElementById('agentUserNotice');
  const title = document.getElementById('agentUserNoticeTitle');
  const body = document.getElementById('agentUserNoticeBody');
  const target = document.getElementById('agentUserNoticeTarget');
  const userStatus = status.agent_user_status || '';
  const pauseKind = status.agent_pause_kind || 'none';
  const label = agentUserStatusLabel(userStatus, userStatus || uiT('ui.agent.waiting_status', 'Ожидание статуса'));
  const targetText = formatOcrTargetForUser(status);
  const mode = status.mode || '';
  const waitingInAutoMode = userStatus === 'read_only' && mode === 'choice_advisor';
  const displayLabel = waitingInAutoMode ? uiT('ui.agent.waiting_actionable_status', 'Ожидание состояния, доступного для действия') : label;
  const displayPauseMessage = waitingInAutoMode && !status.agent_pause_message
    ? uiT('ui.agent.notice.waiting_actionable', 'Автопродвижение включено и ожидает, пока игровая сессия, OCR-реплика или целевое окно станут доступными для действия.')
    : status.agent_pause_message;

  node.hidden = false;
  title.textContent = displayLabel;
  body.textContent = displayPauseMessage
    || (userStatus === 'read_only' && status.mode === 'companion'
      ? uiT('ui.agent.notice.companion_no_advance', 'Окно игры на переднем плане, но режим сопровождения не выполняет автопродвижение. При необходимости переключитесь на автопродвижение.')
      : '')
    || (userStatus === 'running' && status.mode === 'choice_advisor'
      ? uiT('ui.agent.notice.auto_advance_running', 'Окно игры на переднем плане. Agent продолжит в режиме автопродвижения, а OCR будет обновляться в фоне.')
      : '')
    || (userStatus === 'running'
      ? uiT('ui.agent.notice.running', 'Agent работает в текущем режиме. OCR будет обновляться в фоне.')
      : uiT('ui.agent.notice.default', 'Статус Agent автоматически обновляется по окну игры, OCR и настройкам режима.'));
  target.textContent = targetText ? uiTf('ui.agent.notice.target_window', 'Целевое окно: {target}', { target: targetText }) : '';

  node.className = 'agent-user-notice neutral';
  if (
    pauseKind === 'window_not_foreground'
    || pauseKind === 'screen_safety'
    || userStatus === 'paused_window_not_foreground'
    || userStatus === 'screen_safety_pause'
  ) {
    node.classList.add('warning');
  } else if (pauseKind === 'ocr_unavailable' || userStatus === 'ocr_unavailable' || userStatus === 'error') {
    node.classList.add('error');
  } else if (pauseKind === 'read_only' || pauseKind === 'user' || userStatus === 'read_only' || userStatus === 'paused_by_user') {
    node.classList.add('read-only');
  }
}

function buildOcrMissingLineDiagnostic(status = {}) {
  const runtime = status.ocr_reader_runtime || {};
  const rapidocr = status.rapidocr || {};
  const parts = [
    status.ocr_capture_diagnostic_required
      ? uiT('ui.ocr.missing_line.capture_target_abnormal', 'Область OCR-захвата или целевое окно могут быть некорректны')
      : uiT('ui.ocr.missing_line.no_available_line', 'OCR пока не прочитал доступную реплику'),
  ];
  if (status.ocr_capture_diagnostic) {
    parts.push(status.ocr_capture_diagnostic);
  }
  if (status.agent_reason) {
    parts.push(`agent_reason=${status.agent_reason}`);
  }
  if (status.agent_diagnostic) {
    parts.push(status.agent_diagnostic);
  }
  if (runtime.status) {
    parts.push(`status=${runtime.status}`);
  }
  if (runtime.detail) {
    parts.push(`detail=${runtime.detail}`);
  }
  if (runtime.ocr_context_state) {
    parts.push(`context_state=${runtime.ocr_context_state}`);
  }
  const tickBlockReason = textValue(status.ocr_tick_block_reason || runtime.ocr_tick_block_reason);
  if (tickBlockReason) {
    parts.push(`tick_block=${formatOcrTickBlockReason(tickBlockReason)}`);
  }
  const emitBlockReason = textValue(status.ocr_emit_block_reason || runtime.ocr_emit_block_reason);
  if (emitBlockReason) {
    parts.push(`emit_block=${formatOcrEmitBlockReason(emitBlockReason)}`);
  }
  const readerAllowedBlockReason = textValue(
    status.ocr_reader_allowed_block_reason || runtime.ocr_reader_allowed_block_reason,
  );
  if (readerAllowedBlockReason) {
    parts.push(`reader_block=${formatOcrTickBlockReason(readerAllowedBlockReason)}`);
  }
  const displaySourceNotOcrReason = textValue(
    status.display_source_not_ocr_reason || runtime.display_source_not_ocr_reason,
  );
  if (displaySourceNotOcrReason) {
    parts.push(`display_source=${displaySourceNotOcrReason}`);
  }
  if (runtime.backend_kind) {
    parts.push(`backend=${runtime.backend_kind}`);
  }
  if (runtime.backend_detail) {
    parts.push(`backend_detail=${runtime.backend_detail}`);
  }
  if (typeof status.bridge_poll_running === 'boolean') {
    parts.push(`bridge_poll_running=${status.bridge_poll_running}`);
  }
  if (typeof status.bridge_poll_inflight_seconds === 'number') {
    parts.push(`bridge_poll_inflight=${status.bridge_poll_inflight_seconds.toFixed(1)}s`);
  }
  if (typeof status.last_bridge_poll_duration_seconds === 'number') {
    parts.push(`last_poll_duration=${status.last_bridge_poll_duration_seconds.toFixed(1)}s`);
  }
  if (typeof status.pending_ocr_advance_captures === 'number' && status.pending_ocr_advance_captures > 0) {
    parts.push(`pending_ocr=${status.pending_ocr_advance_captures}`);
  }
  if (status.last_ocr_advance_capture_reason) {
    parts.push(`ocr_reason=${status.last_ocr_advance_capture_reason}`);
  }
  if (status.last_error?.message) {
    parts.push(`last_error=${status.last_error.message}`);
  }
  if (rapidocr.detail && rapidocr.detail !== 'installed') {
    parts.push(`rapidocr=${rapidocr.detail}`);
  }
  if (runtime.capture_stage) {
    parts.push(`stage=${runtime.capture_stage}`);
  }
  if (runtime.capture_profile) {
    parts.push(`capture=${formatCaptureProfile(runtime.capture_profile)}`);
  }
  if (runtime.consecutive_no_text_polls) {
    parts.push(`no_text_polls=${runtime.consecutive_no_text_polls}`);
  }
  if (runtime.last_observed_at) {
    parts.push(`last_observed_at=${runtime.last_observed_at}`);
  }
  if (runtime.last_capture_error) {
    parts.push(`last_capture_error=${runtime.last_capture_error}`);
  }
  if (runtime.last_raw_ocr_text) {
    parts.push(`last_raw=${String(runtime.last_raw_ocr_text).slice(0, 80)}`);
  }
  if (runtime.last_rejected_ocr_reason) {
    parts.push(`rejected=${runtime.last_rejected_ocr_reason}`);
  }
  if (runtime.last_rejected_ocr_text) {
    parts.push(`last_rejected=${String(runtime.last_rejected_ocr_text).slice(0, 80)}`);
  }
  return parts.join(' | ');
}

function normalizeLineText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatOcrTriggerMode(value = '') {
  return value === 'after_advance'
    ? uiT('ui.settings.trigger_after_advance', 'Распознавать после клика по реплике')
    : uiT('ui.settings.trigger_interval', 'Распознавать по интервалу');
}

function formatFixedNumber(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '0.0';
}

function isLikelyGameDialogueLine(item = {}) {
  if (!item || item.is_diagnostic) {
    return false;
  }
  const text = normalizeLineText(item.text || '');
  if (!text || text.length < 2 || text.length > 220) {
    return false;
  }
  const lowered = text.toLowerCase();
  const blockedTokens = [
    'agent',
    'capture_failed',
    'context_state=',
    'dxcam:',
    'galgame_',
    'gateway_unavailable',
    'http://',
    'https://',
    'last_error=',
    'ocr_context_unavailable',
    'plugin/',
    'plugin\\',
    'powershell',
    'status=',
    'stability',
    '当前快照',
    '场景 id',
    '场景id',
    '会话 id',
    '会话id',
    '游戏 id',
    '游戏id',
    '菜单是否打开',
    '台词 id',
    '台词id',
    '路线 id',
    '路线id',
    '快照时间',
    '是否过期',
    '退出全屏',
    '收起',
    '全屏',
    'ocr 诊断',
    'recent raw ocr',
    '最近 raw ocr',
  ];
  if (blockedTokens.some((token) => lowered.includes(token))) {
    return false;
  }
  if (text.startsWith('{') || text.startsWith('[') || (text.includes('{') && text.includes('}'))) {
    return false;
  }
  const hasDialoguePunctuation = /[。！？!?…]|——|「|」|『|』|“|”/.test(text);
  const hasWeakDialoguePunctuation = /[，,、：:]/.test(text);
  const hasSpeaker = Boolean(String(item.speaker || '').trim());
  if (hasSpeaker || hasDialoguePunctuation) {
    return true;
  }
  return hasWeakDialoguePunctuation && text.replace(/\s+/g, '').length >= 8;
}

function lineKey(item = {}) {
  const text = normalizeLineText(item.text || '');
  if (text) {
    return [
      item.scene_id || '',
      item.speaker || '',
      text,
    ].join('::');
  }
  return String(item.line_id || '').trim();
}

function mergedHistoryLines(history = {}) {
  const merged = new Map();
  (history.observed_lines || []).forEach((item) => {
    if (!isLikelyGameDialogueLine(item)) {
      return;
    }
    merged.set(lineKey(item), { ...item, stability: item.stability || 'tentative' });
  });
  (history.stable_lines || []).forEach((item) => {
    if (!isLikelyGameDialogueLine(item)) {
      return;
    }
    merged.set(lineKey(item), { ...item, stability: item.stability || 'stable' });
  });
  return Array.from(merged.values());
}

function maxScrollTop(node) {
  if (!node) {
    return 0;
  }
  return Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0));
}

function setScrollPosition(node, top, left = 0) {
  if (!node) {
    return;
  }
  node.scrollTop = Math.min(Math.max(0, Number(top || 0)), maxScrollTop(node));
  if ('scrollLeft' in node) {
    node.scrollLeft = Math.max(0, Number(left || 0));
  }
}

function restoreScrollPosition(node, top, left = 0) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setScrollPosition(node, top, left);
    });
  });
}

function captureRefreshScrollState(root = document) {
  const entries = [];
  const seen = new Set();
  const addNode = (node) => {
    if (!node || seen.has(node)) {
      return;
    }
    seen.add(node);
    entries.push({
      node,
      top: Number(node.scrollTop || 0),
      left: Number(node.scrollLeft || 0),
    });
  };
  addNode(document.scrollingElement || document.documentElement || document.body);
  root.querySelectorAll?.('.scroll-region, .reply-text-scroll').forEach(addNode);
  if (root.classList?.contains('panel-fullscreen')) {
    addNode(root);
  }
  return entries;
}

function restoreRefreshScrollState(entries) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      (entries || []).forEach((entry) => {
        setScrollPosition(entry.node, entry.top, entry.left);
      });
    });
  });
}

function renderPreservingScroll(node, render) {
  if (!node) {
    return;
  }
  const previousTop = Number(node.scrollTop || 0);
  const previousLeft = Number(node.scrollLeft || 0);
  render();
  restoreScrollPosition(node, previousTop, previousLeft);
}

function isScrollableNode(node) {
  return Boolean(node && node.scrollHeight > node.clientHeight + 1);
}

function canScrollNode(node, deltaY) {
  if (!isScrollableNode(node)) {
    return false;
  }
  if (deltaY < 0) {
    return node.scrollTop > 0;
  }
  if (deltaY > 0) {
    return node.scrollTop + node.clientHeight < node.scrollHeight - 1;
  }
  return true;
}

function eventElement(eventTarget) {
  if (eventTarget instanceof Element) {
    return eventTarget;
  }
  return eventTarget?.parentElement || null;
}

function fullscreenWheelTarget(eventTarget, deltaY) {
  const element = eventElement(eventTarget);
  const panel = element?.closest?.('.panel-fullscreen');
  if (!panel) {
    return null;
  }
  let node = element;
  while (node && node !== panel.parentElement) {
    if (
      node.matches?.('.scroll-region, .reply-text-scroll, .module-body, .list-card, .panel-fullscreen')
      && canScrollNode(node, deltaY)
    ) {
      return node;
    }
    if (node === panel) {
      break;
    }
    node = node.parentElement;
  }
  const nested = Array.from(panel.querySelectorAll('.scroll-region, .reply-text-scroll, .module-body, .list-card'))
    .find((candidate) => canScrollNode(candidate, deltaY));
  return nested || (canScrollNode(panel, deltaY) ? panel : null);
}

function exitPanelFullscreen() {
  document.querySelectorAll('.panel-fullscreen').forEach((panel) => {
    panel.classList.remove('panel-fullscreen');
    const button = panel.querySelector('.panel-fullscreen-toggle');
    if (button) {
      button.textContent = uiT('ui.button.fullscreen', 'Во весь экран');
      button.setAttribute('aria-label', uiT('ui.button.fullscreen', 'Во весь экран'));
    }
  });
  document.body.classList.remove('panel-fullscreen-active');
}

function togglePanelFullscreen(panel) {
  if (!panel) {
    return;
  }
  const isActive = panel.classList.contains('panel-fullscreen');
  exitPanelFullscreen();
  if (isActive) {
    return;
  }
  panel.open = true;
  panel.classList.add('panel-fullscreen');
  document.body.classList.add('panel-fullscreen-active');
  const button = panel.querySelector('.panel-fullscreen-toggle');
  if (button) {
    button.textContent = uiT('ui.button.exit_fullscreen', 'Выйти из полного экрана');
    button.setAttribute('aria-label', uiT('ui.button.exit_fullscreen', 'Выйти из полного экрана'));
  }
}

function initializePanelFullscreenControls() {
  document.querySelectorAll('.dashboard-module, .settings-module').forEach((panel) => {
    const summary = panel.querySelector(':scope > summary');
    if (!summary || summary.querySelector('.panel-fullscreen-toggle')) {
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-fullscreen-toggle';
    button.textContent = uiT('ui.button.fullscreen', 'Во весь экран');
    button.setAttribute('aria-label', uiT('ui.button.fullscreen', 'Во весь экран'));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePanelFullscreen(panel);
    });
    summary.appendChild(button);
  });
}

function latestHistoryLine(history = {}) {
  const lines = mergedHistoryLines(history);
  return lines.length ? lines[lines.length - 1] : null;
}

function effectiveCurrentLine(snapshot = {}, history = {}, status = {}) {
  const state = snapshot.snapshot || {};
  if (state.line_id && state.text) {
    return { ...state, source: 'snapshot', stability: state.stability || '' };
  }
  if (snapshot.effective_current_line?.line_id && snapshot.effective_current_line?.text) {
    return { ...snapshot.effective_current_line };
  }
  if (status.effective_current_line?.line_id && status.effective_current_line?.text) {
    return { ...status.effective_current_line };
  }
  return latestHistoryLine(history) || {};
}

function buildSuggestFallback(sceneId = '', diagnostic = uiT('ui.const.no_visible_choices', 'видимых вариантов нет')) {
  return {
    degraded: true,
    scene_id: sceneId,
    choices: [],
    diagnostic,
  };
}

function renderGrid(nodeId, rows) {
  const container = document.getElementById(nodeId);
  renderPreservingScroll(container, () => {
    container.innerHTML = renderDataRows(rows);
  });
}

function rawStatusLabel(key, fallback = '') {
  const raw = String(key ?? '');
  const normalized = raw.trim().toLowerCase();
  // Only remap short single-token status-like values; free text is passed through.
  if (normalized.length > 40 || /\s/.test(normalized) || /[{}]/.test(normalized)) {
    return fallback || raw;
  }
  const labelMap = {
    on: 'ui.const.on',
    off: 'ui.const.off',
    yes: 'ui.common.yes',
    no: 'ui.common.no',
    true: 'ui.const.true',
    false: 'ui.const.false',
    auto: 'ui.const.auto',
    active: 'ui.const.active',
    standby: 'ui.const.standby',
    idle: 'ui.const.idle',
    unknown: 'ui.const.unknown',
    diagnostic: 'ui.const.diagnostic',
    fixed: 'ui.const.fixed',
    dxcam: 'ui.const.dxcam',
    smart: 'ui.const.smart',
    bridge_sdk_level: 'ui.const.bridge_sdk_level',
    weaker_than_bridge_sdk: 'ui.const.weaker_than_bridge_sdk',
  };
  const i18nKey = labelMap[normalized];
  const fallbackText = fallback || String(key ?? '');
  return i18nKey ? uiT(i18nKey, fallbackText) : fallbackText;
}

function renderDataRows(rows) {
  return rows.map((row) => {
    const value = row.format ? formatDebugValue(row.value) : rawStatusLabel(row.value, formatDebugValue(row.value));
    return `
    <div class="data-row">
      <dt>${escapeHtml(fieldLabel(row.label))}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
  }).join('');
}

function renderStatusGrid(rows, debugRows) {
  const container = document.getElementById('statusGrid');
  const debugWasOpen = Boolean(container?.querySelector('.status-debug-panel')?.open);
  renderPreservingScroll(container, () => {
    container.innerHTML = `
      <dl class="data-grid status-grid-primary">
        ${renderDataRows(rows)}
      </dl>
      <details class="status-debug-panel"${debugWasOpen ? ' open' : ''}>
        <summary>
          <span>${escapeHtml(uiT('ui.status.debug_title', 'Расширенная отладка'))}</span>
          <small>${escapeHtml(uiTf('ui.status.debug_count', '{count} внутренних состояний', { count: debugRows.length }))}</small>
        </summary>
        <dl class="data-grid">
          ${renderDataRows(debugRows)}
        </dl>
      </details>
    `;
  });
}

function renderStackList(nodeId, items, formatter) {
  const node = document.getElementById(nodeId);
  if (!items.length) {
    renderPreservingScroll(node, () => {
      node.className = 'stack-list scroll-region empty-state';
      node.textContent = uiT('ui.empty.no_data', 'Нет данных');
    });
    return;
  }
  renderPreservingScroll(node, () => {
    node.className = 'stack-list scroll-region';
    node.innerHTML = items.map(formatter).join('');
  });
}

function isInstallTaskTerminal(state) {
  return Boolean(state) && INSTALL_TERMINAL_STATUSES.has(String(state.status || ''));
}

function installTaskUpdatedAtSeconds(state) {
  return Number((state || {}).completed_at || (state || {}).updated_at || (state || {}).finished_at || 0);
}

function isRecentLocalCompletedInstallTask(state) {
  if (!state || String(state.status || '') !== 'completed' || state.__restored) {
    return false;
  }
  const updatedAt = installTaskUpdatedAtSeconds(state);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return false;
  }
  return ((Date.now() / 1000) - updatedAt) <= INSTALL_COMPLETED_REFRESH_GRACE_SECONDS;
}

function shouldOfferRapidOcrModelsDownload(rapidocr = {}) {
  return Boolean(
    rapidocr.detail === 'missing_model_files'
    && rapidocr.can_download_models
    && !rapidocr.installed
  );
}

function shouldRestoreRapidOcrModelsFailure(state, status = latestStatus) {
  if (String((state || {}).status || '') !== 'failed') {
    return false;
  }
  return shouldOfferRapidOcrModelsDownload((status || {}).rapidocr || {});
}

function shouldRestoreInstallTaskState(kind, state, status = latestStatus) {
  if (!state) {
    return false;
  }
  if (kind === 'rapidocr_models' && String(state.status || '') === 'failed') {
    return shouldRestoreRapidOcrModelsFailure(state, status);
  }
  return !isInstallTaskTerminal(state);
}

function canApplyRestoredInstallTaskState(kind, restoredTaskId, restoreGeneration) {
  const runtime = installRuntime[kind];
  if (!runtime) {
    return true;
  }
  if (Number(runtime.generation || 0) !== Number(restoreGeneration || 0)) {
    return false;
  }
  if (!runtime.inProgress) {
    return true;
  }
  const currentTaskId = String(runtime.currentTaskId || '');
  return Boolean(restoredTaskId && currentTaskId && restoredTaskId === currentTaskId);
}

function installStatusPriority(status) {
  const normalized = String(status || '').trim();
  if (normalized === 'completed') {
    return 3;
  }
  if (normalized === 'failed') {
    return 2;
  }
  if (normalized === 'canceled') {
    return 1;
  }
  return 0;
}

function selectPreferredInstallState(primary, secondary) {
  if (!primary) {
    return secondary;
  }
  if (!secondary) {
    return primary;
  }

  const primaryTerminal = isInstallTaskTerminal(primary);
  const secondaryTerminal = isInstallTaskTerminal(secondary);
  if (primaryTerminal !== secondaryTerminal) {
    return primaryTerminal ? secondary : primary;
  }

  const primaryUpdated = Number(primary.updated_at || primary.started_at || 0);
  const secondaryUpdated = Number(secondary.updated_at || secondary.started_at || 0);
  if (primaryUpdated !== secondaryUpdated) {
    return primaryUpdated >= secondaryUpdated ? primary : secondary;
  }

  const primaryPriority = installStatusPriority(primary.status);
  const secondaryPriority = installStatusPriority(secondary.status);
  if (primaryPriority !== secondaryPriority) {
    return primaryPriority >= secondaryPriority ? primary : secondary;
  }

  return primary;
}

function persistInstallTaskId(kind, taskId) {
  if (!taskId) {
    return;
  }
  storageSet(getInstallConfig(kind).storageKey, taskId);
}

function readPersistedInstallTaskId(kind) {
  return storageGet(getInstallConfig(kind).storageKey);
}

function clearPersistedInstallTaskId(kind) {
  storageRemove(getInstallConfig(kind).storageKey);
}

function clearInstallReconnectTimer(kind) {
  const state = getInstallState(kind);
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

function closeInstallStream(kind) {
  const state = getInstallState(kind);
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 100 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function formatInstallPhase(phase) {
  const normalized = String(phase || '').trim();
  const mapping = {
    queued: uiT('ui.install.phase.queued', 'В очереди'),
    metadata: uiT('ui.install.phase.metadata', 'Получение метаданных установки'),
    downloading: uiT('ui.install.phase.downloading', 'Загрузка по HTTPS'),
    installing: uiT('ui.install.phase.installing', 'Запуск установщика'),
    extracting: uiT('ui.install.phase.extracting', 'Распаковка установки'),
    languages: uiT('ui.install.phase.languages', 'Загрузка языковых пакетов'),
    verifying: uiT('ui.install.phase.verifying', 'Проверка установки'),
    completed: uiT('ui.install.phase.completed', 'Установка завершена'),
    failed: uiT('ui.install.phase.failed', 'Установка не удалась'),
    canceled: uiT('ui.install.phase.canceled', 'Отменено'),
  };
  return uiDynamicT('ui.install.phase', normalized, mapping[normalized] || normalized || uiT('ui.install.phase.waiting', 'Ожидание'));
}

function formatCaptureProfile(profile) {
  const source = profile || {};
  const rows = [
    ['left', source.left_inset_ratio],
    ['right', source.right_inset_ratio],
    ['top', source.top_ratio],
    ['bottom', source.bottom_inset_ratio],
  ].filter(([, value]) => typeof value === 'number' && Number.isFinite(value));
  if (!rows.length) {
    return '';
  }
  return rows.map(([label, value]) => `${label}=${Number(value).toFixed(2)}`).join(' | ');
}

function normalizeProcessName(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCaptureProfileSaveScope(value) {
  const normalized = String(value || '').trim();
  return normalized === 'window_bucket' ? 'window_bucket' : 'process_fallback';
}

function normalizeCaptureProfileBucketKey(value) {
  return String(value || '').trim().toLowerCase();
}

function buildCaptureProfileBucketKey(width, height) {
  const normalizedWidth = Math.max(0, Number(width || 0));
  const normalizedHeight = Math.max(0, Number(height || 0));
  if (!normalizedWidth || !normalizedHeight) {
    return '';
  }
  return `${Math.round(normalizedWidth)}x${Math.round(normalizedHeight)}`;
}

function isRatioProfileValue(value) {
  return Boolean(value)
    && typeof value === 'object'
    && ['left_inset_ratio', 'right_inset_ratio', 'top_ratio', 'bottom_inset_ratio']
      .every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]));
}

function isAihongProcessName(value) {
  return AIHONG_PROCESS_NAMES.has(normalizeProcessName(value));
}

function findStoredCaptureProfileEntry(status, processName) {
  const profiles = status?.ocr_capture_profiles || {};
  const direct = profiles[processName];
  if (direct) {
    return direct;
  }
  const normalizedProcessName = normalizeProcessName(processName);
  return Object.entries(profiles).find(([name]) => normalizeProcessName(name) === normalizedProcessName)?.[1] || null;
}

function resolveStoredFallbackCaptureProfile(entry, stage) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  if (isRatioProfileValue(entry)) {
    return entry;
  }
  const stageEntry = entry[stage];
  if (isRatioProfileValue(stageEntry)) {
    return stageEntry;
  }
  const defaultEntry = entry.default;
  if (isRatioProfileValue(defaultEntry)) {
    return defaultEntry;
  }
  return null;
}

function resolveStoredBucketCaptureProfile(entry, stage, bucketKey) {
  if (!entry || typeof entry !== 'object' || !bucketKey) {
    return null;
  }
  const buckets = entry.__window_buckets__;
  if (!buckets || typeof buckets !== 'object') {
    return null;
  }
  const normalizedBucketKey = normalizeCaptureProfileBucketKey(bucketKey);
  const directBucket = buckets[normalizedBucketKey];
  const bucketEntry = directBucket
    || Object.entries(buckets).find(([key]) => normalizeCaptureProfileBucketKey(key) === normalizedBucketKey)?.[1]
    || null;
  if (!bucketEntry || typeof bucketEntry !== 'object') {
    return null;
  }
  const bucketStages = bucketEntry.stages;
  if (!bucketStages || typeof bucketStages !== 'object') {
    return null;
  }
  const stageEntry = bucketStages[stage];
  if (isRatioProfileValue(stageEntry)) {
    return stageEntry;
  }
  const defaultEntry = bucketStages.default;
  if (isRatioProfileValue(defaultEntry)) {
    return defaultEntry;
  }
  return null;
}

function resolveRuntimeDefaultSaveScope(status, processName) {
  const runtime = status?.ocr_reader_runtime || {};
  return normalizeProcessName(processName)
    && normalizeProcessName(processName) === normalizeProcessName(runtime.process_name)
    && Number(runtime.width || 0) > 0
    && Number(runtime.height || 0) > 0
    ? 'window_bucket'
    : 'process_fallback';
}

function resolveEditableCaptureProfile(status, processName, stage, saveScope, gamePresetId = 'auto') {
  const selectedGamePreset = OCR_GAME_CAPTURE_PRESETS[String(gamePresetId || '').trim()];
  const selectedStageProfile = selectedGamePreset?.profiles?.[stage];
  if (isRatioProfileValue(selectedStageProfile)) {
    return selectedStageProfile;
  }

  const runtime = status?.ocr_reader_runtime || {};
  const entry = findStoredCaptureProfileEntry(status, processName);
  const normalizedScope = normalizeCaptureProfileSaveScope(saveScope);
  const runtimeProcessMatches = normalizeProcessName(processName)
    && normalizeProcessName(processName) === normalizeProcessName(runtime.process_name);
  const runtimeBucketKey = normalizeCaptureProfileBucketKey(
    runtime.capture_profile_bucket_key || buildCaptureProfileBucketKey(runtime.width, runtime.height),
  );

  if (normalizedScope === 'window_bucket') {
    const storedBucketProfile = resolveStoredBucketCaptureProfile(entry, stage, runtimeBucketKey);
    if (storedBucketProfile) {
      return storedBucketProfile;
    }
    if (runtimeProcessMatches && runtime.capture_profile && runtimeBucketKey) {
      return runtime.capture_profile;
    }
  } else {
    const storedFallbackProfile = resolveStoredFallbackCaptureProfile(entry, stage);
    if (storedFallbackProfile) {
      return storedFallbackProfile;
    }
    if (
      runtimeProcessMatches
      && runtime.capture_profile
      && !['bucket_exact', 'bucket_aspect_nearest'].includes(String(runtime.capture_profile_match_source || ''))
    ) {
      return runtime.capture_profile;
    }
  }
  if (isAihongProcessName(processName) && AIHONG_CAPTURE_PRESETS[stage]) {
    return AIHONG_CAPTURE_PRESETS[stage];
  }
  if (SENREN_BANKA_PROCESS_NAMES.has(normalizeProcessName(processName)) && SENREN_BANKA_CAPTURE_PRESETS[stage]) {
    return SENREN_BANKA_CAPTURE_PRESETS[stage];
  }
  return DEFAULT_CAPTURE_PROFILE;
}

function setInputValueIfIdle(node, value) {
  if (!node) {
    return;
  }
  if (document.activeElement === node) {
    return;
  }
  node.value = value;
}

function profileValueForInputs(runtimeProfile) {
  const merged = {
    ...DEFAULT_CAPTURE_PROFILE,
    ...(runtimeProfile || {}),
  };
  return {
    left: Number(merged.left_inset_ratio).toFixed(2),
    right: Number(merged.right_inset_ratio).toFixed(2),
    top: Number(merged.top_ratio).toFixed(2),
    bottom: Number(merged.bottom_inset_ratio).toFixed(2),
  };
}

function renderInstallTaskState(kind) {
  const state = getInstallState(kind).state;
  const { card, statusText, percentText, messageText, detailText, progressBar, button } = getInstallNodes(kind);
  const { label } = getInstallConfig(kind);

  if (!card || !statusText || !percentText || !messageText || !detailText || !progressBar) {
    return;
  }

  if (!state) {
    card.hidden = true;
    card.style.display = '';
    if (button) {
      button.hidden = false;
      setActionButtonDisabled(button, false);
    }
    statusText.textContent = uiTf('ui.install.task.waiting', 'Ожидание задачи установки {label}', { label });
    percentText.textContent = '0%';
    messageText.textContent = '';
    detailText.textContent = '';
    progressBar.style.width = '0%';
    return;
  }

  const progress = Math.max(0, Math.min(1, Number(state.progress || 0)));
  const percent = Math.round(progress * 100);
  const details = [];
  if (state.total_bytes) {
    details.push(`${formatBytes(state.downloaded_bytes)} / ${formatBytes(state.total_bytes)}`);
  } else if (state.downloaded_bytes) {
    details.push(formatBytes(state.downloaded_bytes));
  }
  if (state.resume_from) {
    details.push(uiTf('ui.install.task.resume_from', 'Возобновление с {size}', { size: formatBytes(state.resume_from) }));
  }
  if (state.asset_name) {
    details.push(state.asset_name);
  }
  if (state.task_id) {
    details.push(`task ${state.task_id}`);
  }

  card.hidden = false;
  card.style.display = '';
  statusText.textContent = `${formatInstallPhase(state.phase)} · ${state.status || ''}`;
  percentText.textContent = `${percent}%`;
  messageText.textContent = state.message || '';
  detailText.textContent = details.join(' · ');
  progressBar.style.width = `${percent}%`;
  const rapidocr = latestStatus && latestStatus.rapidocr ? latestStatus.rapidocr : {};
  const rapidocrModelsStillMissing = kind === 'rapidocr_models' && rapidocr.detail === 'missing_model_files';
  if (state.status === 'completed') {
    if (button) {
      const terminalCompleted = !rapidocrModelsStillMissing;
      button.hidden = terminalCompleted;
      setActionButtonDisabled(button, terminalCompleted);
      if (rapidocrModelsStillMissing) {
        button.textContent = getInstallConfig(kind).retryText;
      }
    }
  } else if (state.status === 'failed') {
    if (button) {
      button.hidden = false;
      setActionButtonDisabled(button, false);
      button.textContent = getInstallConfig(kind).retryText;
    }
  }
}

function applyRapidOcrModelsGate(rapidocr = {}) {
  const { card, statusText, percentText, messageText, detailText, progressBar, button } = getInstallNodes('rapidocr_models');
  const runtime = installRuntime.rapidocr_models;
  let state = runtime.state;
  const config = getInstallConfig('rapidocr_models');
  const installed = Boolean(rapidocr.installed);
  const missingModels = rapidocr.detail === 'missing_model_files';
  const downloadable = shouldOfferRapidOcrModelsDownload(rapidocr);
  if (state && state.status === 'failed' && !downloadable) {
    clearPersistedInstallTaskId('rapidocr_models');
    runtime.state = null;
    runtime.currentTaskId = '';
    runtime.inProgress = false;
    state = null;
  }
  const running = Boolean(state && !isInstallTaskTerminal(state));
  const waitingRefresh = Boolean(isRecentLocalCompletedInstallTask(state) && missingModels && !installed);
  const retryableFailure = Boolean(state && state.status === 'failed' && downloadable);
  const showCard = Boolean(state && (running || waitingRefresh || retryableFailure));
  const waitingRefreshText = uiT('ui.install.task_done_refreshing', 'Задача выполнена — ожидание обновления статуса плагина.');

  if (card) {
    card.hidden = !showCard;
  }
  if (waitingRefresh) {
    if (statusText) statusText.textContent = `${formatInstallPhase(state.phase)} · completed`;
    if (percentText) percentText.textContent = '100%';
    if (messageText) messageText.textContent = state.message || waitingRefreshText;
    if (detailText) detailText.textContent = '';
    if (progressBar) progressBar.style.width = '100%';
  } else if (!showCard) {
    if (statusText) statusText.textContent = uiT('ui.install.waiting_task', 'Ожидание задачи установки');
    if (percentText) percentText.textContent = '0%';
    if (messageText) messageText.textContent = '';
    if (detailText) detailText.textContent = '';
    if (progressBar) progressBar.style.width = '0%';
  }
  if (!button) {
    return;
  }

  button.hidden = !(running || waitingRefresh || retryableFailure || downloadable);
  button.disabled = running || waitingRefresh || (!downloadable && !retryableFailure);
  if (running) {
    button.textContent = config.runningText;
  } else if (waitingRefresh) {
    button.textContent = waitingRefreshText;
  } else if (retryableFailure) {
    button.textContent = config.retryText;
  } else {
    button.textContent = config.actionText;
  }
}

function clearRapidOcrModelsControls() {
  const { card, statusText, percentText, messageText, detailText, progressBar, button } = getInstallNodes('rapidocr_models');
  if (card) {
    card.hidden = true;
  }
  if (statusText) statusText.textContent = uiT('ui.install.waiting_task', 'Ожидание задачи установки');
  if (percentText) percentText.textContent = '0%';
  if (messageText) messageText.textContent = '';
  if (detailText) detailText.textContent = '';
  if (progressBar) progressBar.style.width = '0%';
  if (button) {
    button.hidden = true;
    button.disabled = true;
    button.textContent = getInstallConfig('rapidocr_models').actionText;
  }
}

function renderPluginUnavailable(error) {
  latestStatus = null;
  pendingModeSelection = '';
  updateModeSwitchControl('', { ready: false });
  const pluginNotStarted = uiT('ui.diag.plugin_not_started.title', 'Плагин не запущен');
  const message = error instanceof Error ? error.message : String(error || pluginNotStarted);
  setSummaryText(document.getElementById('summaryText'), pluginNotStarted);
  renderPrimaryDiagnosis({
    connection_state: 'plugin_not_started',
    last_error: null,
    primary_diagnosis: {
      severity: 'info',
      title: pluginNotStarted,
      message: uiT('ui.diag.plugin_not_started.body', 'Нажмите "Запустить" на странице управления плагином. После запуска данные обновятся автоматически.'),
      actions: [
        diagnosisAction('refresh_all'),
      ],
    },
    summary: pluginNotStarted,
  });
  renderFirstRunGuide({});
  renderCurrentLineOverview({});
  renderOcrPipelinePanel({});
  renderInstallCompactSummary({});
  renderStatusGrid([
    { label: 'connection_state', value: 'plugin_not_started' },
    { label: 'status', value: pluginNotStarted },
    { label: 'last_error', value: message },
  ], []);
  renderGrid('ocrRuntimeGrid', [
    { label: 'status', value: pluginNotStarted },
  ]);
  renderGrid('snapshotGrid', [
    { label: 'status', value: pluginNotStarted },
  ]);

  const PROMPT_LABELS = {
    rapidocr: 'RapidOCR',
    dxcam: 'DXcam',
    textractor: 'Textractor',
  };
  for (const kind of ['rapidocr', 'dxcam', 'textractor']) {
    const card = document.getElementById(`${kind}Card`);
    if (!card) {
      continue;
    }
    const chip = document.getElementById(`${kind}CardChip`);
    const desc = document.getElementById(`${kind}CardDesc`);
    const meta = document.getElementById(`${kind}CardMeta`);
    const actions = document.getElementById(`${kind}CardActions`);
    card.className = 'install-card neutral';
    if (chip) chip.textContent = pluginNotStarted;
    if (desc) desc.textContent = uiT('ui.install.plugin_unavailable_body', 'Сейчас невозможно прочитать состояние выполнения плагина. Сначала запустите или перезагрузите galgame_plugin; после запуска здесь появятся статусы установки и выполнения.');
    if (meta) meta.textContent = `${PROMPT_LABELS[kind]} · ${message}`;
    if (actions) syncActionButtons(actions, '');
    if (kind === 'rapidocr') {
      const card = document.getElementById('rapidocrInstallCard');
      if (card) {
        card.hidden = true;
        card.style.display = 'none';
      }
    } else if (kind === 'textractor') {
      const { button, card } = getInstallNodes(kind);
      if (card) {
        card.hidden = true;
        card.style.display = 'none';
      }
      if (button) {
        button.hidden = true;
        button.disabled = true;
      }
    }
  }
  clearRapidOcrModelsControls();
}

function applyInstallTaskState(kind, state, { allowRefresh = true, showTerminalFlash = true } = {}) {
  if (!state) {
    return;
  }
  const installState = getInstallState(kind);
  installState.state = state;
  installState.currentTaskId = state.task_id || state.run_id || installState.currentTaskId;
  if (installState.currentTaskId) {
    if (isInstallTaskTerminal(state)) {
      if (!(kind === 'rapidocr_models' && String(state.status || '') === 'failed')) {
        clearPersistedInstallTaskId(kind);
      }
    } else {
      persistInstallTaskId(kind, installState.currentTaskId);
    }
  }
  installState.inProgress = !isInstallTaskTerminal(state);

  if (latestStatus) {
    renderStatus(latestStatus);
  } else {
    renderInstallTaskState(kind);
  }

  if (!isInstallTaskTerminal(state)) {
    return;
  }

  closeInstallStream(kind);
  clearInstallReconnectTimer(kind);
  const terminalKey = `${installState.currentTaskId}:${state.status || ''}:${state.updated_at || ''}`;
  if (installState.handledTerminalKey === terminalKey) {
    return;
  }
  installState.handledTerminalKey = terminalKey;

  if (showTerminalFlash) {
    const config = getInstallConfig(kind);
    if (state.status === 'completed') {
      setFlash(state.message || config.successFlash, 'success');
    } else {
      setFlash(state.error || state.message || config.failureFlash, 'error');
    }
  }

  if (allowRefresh) {
    refreshAll({ preserveFlash: true, forceInsights: true }).catch((error) => {
      setFlash(error instanceof Error ? error.message : String(error), 'error');
    });
    if (kind === 'rapidocr_models' && state.status === 'completed') {
      setTimeout(() => {
        refreshAll({ preserveFlash: true, forceInsights: true, forceRefresh: true }).catch((error) => {
          setFlash(error instanceof Error ? error.message : String(error), 'error');
        });
      }, 750);
    }
  }
}

async function fetchInstallTaskState(kind, taskId) {
  const response = await fetch(`${getInstallConfig(kind).url}/${encodeURIComponent(taskId)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(uiTf('ui.error.install_state_read_failed', 'Не удалось прочитать статус установки {label}: HTTP {status}', {
      label: getInstallConfig(kind).label,
      status: response.status,
    }));
  }
  return await response.json();
}

async function fetchLatestInstallTaskState(kind) {
  const response = await fetch(`${getInstallConfig(kind).url}/latest`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(uiTf('ui.error.latest_install_state_read_failed', 'Не удалось прочитать последний статус установки {label}: HTTP {status}', {
      label: getInstallConfig(kind).label,
      status: response.status,
    }));
  }
  return await response.json();
}

function scheduleInstallReconnect(kind, taskId) {
  const state = getInstallState(kind);
  clearInstallReconnectTimer(kind);
  state.reconnectTimer = setTimeout(async () => {
    try {
      const recovered = await fetchInstallTaskState(kind, taskId);
      if (recovered) {
        applyInstallTaskState(kind, recovered, { allowRefresh: false });
        if (!isInstallTaskTerminal(recovered)) {
          connectInstallStream(kind, taskId);
        }
        return;
      }
    } catch (_) {
      // Keep retrying until we observe a terminal state or the server becomes reachable again.
    }

    if (!state.state || !isInstallTaskTerminal(state.state)) {
      scheduleInstallReconnect(kind, taskId);
    }
  }, 1500);
}

function connectInstallStream(kind, taskId) {
  const state = getInstallState(kind);
  closeInstallStream(kind);
  clearInstallReconnectTimer(kind);
  const stream = new EventSource(`${getInstallConfig(kind).url}/${encodeURIComponent(taskId)}/stream`);
  state.eventSource = stream;

  stream.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      applyInstallTaskState(kind, payload);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  stream.onerror = async () => {
    if (state.eventSource !== stream) {
      return;
    }
    stream.close();
    state.eventSource = null;
    if (state.state && isInstallTaskTerminal(state.state)) {
      return;
    }
    try {
      const recovered = await fetchInstallTaskState(kind, taskId);
      if (recovered) {
        applyInstallTaskState(kind, recovered, { allowRefresh: false });
      }
    } catch (_) {
      // Ignore transient recovery failures and retry shortly.
    }
    scheduleInstallReconnect(kind, taskId);
  };
}

async function restoreInstallState(kind) {
  const runtime = installRuntime[kind];
  const restoreGeneration = Number((runtime && runtime.generation) || 0);
  const persistedTaskId = readPersistedInstallTaskId(kind);
  let persistedState = null;
  let latestState = null;

  if (persistedTaskId) {
    try {
      persistedState = await fetchInstallTaskState(kind, persistedTaskId);
      if (!persistedState) {
        clearPersistedInstallTaskId(kind);
      } else if (!shouldRestoreInstallTaskState(kind, persistedState, latestStatus)) {
        clearPersistedInstallTaskId(kind);
        persistedState = null;
      }
    } catch (_) {
      persistedState = null;
    }
  }

  try {
    latestState = await fetchLatestInstallTaskState(kind);
    if (!shouldRestoreInstallTaskState(kind, latestState, latestStatus)) {
      latestState = null;
    }
  } catch (_) {
    latestState = null;
  }

  const restoredState = selectPreferredInstallState(persistedState, latestState);
  if (!restoredState) {
    return;
  }

  const restoredTaskId = restoredState.task_id || restoredState.run_id || '';
  if (!canApplyRestoredInstallTaskState(kind, restoredTaskId, restoreGeneration)) {
    return;
  }

  const restoredStateForApply = { ...restoredState, __restored: true };
  applyInstallTaskState(kind, restoredStateForApply, { allowRefresh: false, showTerminalFlash: false });
  if (restoredTaskId && !isInstallTaskTerminal(restoredState)) {
    connectInstallStream(kind, restoredTaskId);
  }
}

async function restoreTextractorInstallState() {
  await restoreInstallState('textractor');
}

// restoreRapidOcrInstallState / restoreDxcamInstallState removed — both
// kinds no longer have install machinery (bundled into main program).

async function restoreRapidOcrModelsState() {
  // Same lifecycle as the install task kinds: re-fetch persisted task,
  // reconnect SSE if still running, surface the failure card on terminal
  // failure. Without this, refreshing the page mid-download loses the
  // progress card / retry button — the SSE stream and persisted state
  // both still exist server-side but the UI forgets about them.
  await restoreInstallState('rapidocr_models');
}

let selectedTtsPipeline = 'agent';

function normalizeTtsPipeline(value) {
  const v = String(value || '').trim().toLowerCase();
  return ['agent', 'direct', 'off'].includes(v) ? v : 'agent';
}

function getSelectedTtsPipeline() {
  const active = document.querySelector('#ttsPipelineSwitch .pipeline-btn.active');
  if (active && active.dataset && active.dataset.pipeline) {
    return normalizeTtsPipeline(active.dataset.pipeline);
  }
  return normalizeTtsPipeline(selectedTtsPipeline);
}

function updateTtsPipelineSwitchControl(pipeline, { ready = true } = {}) {
  const normalized = normalizeTtsPipeline(pipeline);
  selectedTtsPipeline = normalized;
  const wrap = document.getElementById('ttsPipelineSwitch');
  if (!wrap) return;
  wrap.dataset.ready = ready ? 'true' : 'false';
  document.querySelectorAll('#ttsPipelineSwitch .pipeline-btn').forEach((btn) => {
    const on = ready && normalizeTtsPipeline(btn.dataset.pipeline) === normalized;
    btn.classList.toggle('active', on);
    btn.disabled = !ready;
    btn.setAttribute('aria-disabled', ready ? 'false' : 'true');
  });
}

async function setTtsPipeline(nextPipeline, { silentFlash = false, persist = true } = {}) {
  const pipeline = normalizeTtsPipeline(nextPipeline);
  const prev = normalizeTtsPipeline((latestStatus && latestStatus.tts_output_pipeline) || selectedTtsPipeline);
  updateTtsPipelineSwitchControl(pipeline);
  if (!persist) {
    if (latestStatus) latestStatus.tts_output_pipeline = pipeline;
    return;
  }
  try {
    await callPlugin('galgame_set_tts_pipeline', { pipeline });
    if (latestStatus) latestStatus.tts_output_pipeline = pipeline;
    if (!silentFlash) {
      setFlash(uiTf('ui.flash.tts_pipeline_saved', 'Режим озвучки: {pipeline}', { pipeline: ttsPipelineLabel(pipeline) }), 'success');
    }
  } catch (error) {
    updateTtsPipelineSwitchControl(prev);
    if (!silentFlash) setFlash(error instanceof Error ? error.message : String(error), 'error');
    throw error;
  }
}

const INSPECTOR_DEFAULT = {
  titleKey: 'ui.inspector.title',
  titleFallback: 'Справка элемента',
  hintKey: 'ui.inspector.hint',
  hintFallback: 'Наведите курсор на элемент, чтобы увидеть подробное описание.',
};

const INSPECTOR_DATA = [
  { selector: '#modeSwitch .mode-btn[data-mode="narrator"], #modeSelect option[value="narrator"]', title: 'Режим «Рассказчик»', desc: 'Озвучивает/пересказывает новые реплики без автоматических действий в игре.', on: 'Плагин отправляет narration по сцене согласно выбранному TTS-конвейеру.', off: 'Переключите режим (компаньон, советник, тихий), чтобы изменить поведение.' },
  { selector: '#modeSwitch .mode-btn[data-mode="choice_advisor"], #modeSelect option[value="choice_advisor"]', title: 'Режим «Советник по выбору»', desc: 'Помогает с вариантами выбора и сопровождает сцену с акцентом на решения.', on: 'Плагин анализирует варианты и даёт советы/подсказки по выбору.', off: 'При смене режима советы по выбору и связанная активность советника отключаются.' },
  { selector: '#modeSwitch .mode-btn[data-mode="companion"], #modeSelect option[value="companion"]', title: 'Режим «Компаньон»', desc: 'Сопровождает чтение и даёт контекст без автокликов по вариантам.', on: 'Плагин может комментировать происходящее, но не управляет игрой.', off: 'При смене режима компаньонские подсказки перестанут отправляться.' },
  { selector: '#modeSwitch .mode-btn[data-mode="silent"], #modeSelect option[value="silent"]', title: 'Тихий режим', desc: 'Минимум вмешательства и сообщений от агента.', on: 'Агент не будет активно подсказывать/озвучивать от себя.', off: 'Выберите другой режим, чтобы включить помощь, рассказ или советы.' },
  { selector: '#ttsPipelineSwitch .pipeline-btn[data-pipeline="agent"]', title: 'TTS: через агента', desc: 'Текст narration подготавливается агентом/LLM перед передачей в конвейер озвучки.', on: 'Реплики проходят через агентский путь (режим диктора).', off: 'Выберите «Напрямую» или «Выкл», чтобы изменить конвейер.' },
  { selector: '#ttsPipelineSwitch .pipeline-btn[data-pipeline="direct"]', title: 'TTS: напрямую', desc: 'Передача текста narration без LLM-фильтра диктора (ближе к исходной реплике).', on: 'Используется прямой текстовый путь narration.', off: 'Выберите «Через агента» или «Выкл».' },
  { selector: '#ttsPipelineSwitch .pipeline-btn[data-pipeline="off"]', title: 'TTS: выкл', desc: 'Отключает TTS-конвейер рассказчика.', on: 'Новые реплики не отправляются в озвучку.', off: 'Выберите «Через агента» или «Напрямую», чтобы включить озвучку.' },
  { selector: '#ocrReaderCaptureBackendSelect, label[for="ocrReaderCaptureBackendSelect"]', title: 'Бэкенд захвата (DXcam)', desc: 'Способ захвата окна/экрана для OCR. DXcam — быстрый вариант для Windows (Direct3D), если доступен.', on: 'При выборе DXcam используется соответствующий захват.', off: 'Другие бэкенды могут быть медленнее или менее совместимы в зависимости от игры.' },
  { selector: '#ocrProfileAutoRecalibrateBtn', title: 'Автокалибровка области диалога', desc: 'Автоматически подбирает/обновляет профиль области захвата для OCR.', on: 'Запустится подбор/пересчёт области диалога для текущего окна.', off: 'Профиль останется прежним; область можно настроить вручную.' },
  { selector: '#ocrWindowSelectBtn, #ocrWindowSelectLabel, #ocrWindowSelectValue, #ocrWindowAutoBtn, #ocrWindowRefreshBtn', title: 'Выбор окна для OCR', desc: 'Целевое окно игры, из которого берётся изображение для распознавания текста.', on: 'OCR будет работать по выбранному (или автоматически определённому) окну.', off: 'Неверное окно приведёт к пустому или ошибочному распознаванию.' },
  { selector: '#memoryProcessSelectBtn, #memoryProcessSelectLabel, #memoryProcessAutoBtn, #memoryProcessRefreshBtn', title: 'Выбор процесса (Memory Reader)', desc: 'Процесс игры для чтения текста из памяти.', on: 'Чтение памяти привязывается к выбранному процессу.', off: 'Без корректного процесса Memory Reader может быть недоступен.' },
  { selector: '#speedSwitch .speed-btn, #speedSwitch', title: 'Скорость продвижения', desc: 'Темп ожиданий/действий при автоматическом сопровождении.', on: 'Быстрее — меньше паузы между шагами; медленнее — осторожнее.', off: 'Можно выбрать более медленный темп для стабильности.' },
];

let inspectorPinned = false;

function findInspectorEntry(target) {
  if (!target || typeof target.closest !== 'function') return null;
  for (const entry of INSPECTOR_DATA) {
    try {
      if (target.closest(entry.selector)) return entry;
    } catch (_) {}
  }
  return null;
}

function showInspectorEntry(entry) {
  const title = document.getElementById('inspectorTitle');
  const hint = document.getElementById('inspectorHint');
  const details = document.getElementById('inspectorDetails');
  const desc = document.getElementById('inspectorDesc');
  const on = document.getElementById('inspectorOn');
  const off = document.getElementById('inspectorOff');
  if (!title || !hint || !details || !desc || !on || !off) return;
  if (!entry) {
    title.textContent = uiT(INSPECTOR_DEFAULT.titleKey, INSPECTOR_DEFAULT.titleFallback);
    hint.hidden = false;
    hint.textContent = uiT(INSPECTOR_DEFAULT.hintKey, INSPECTOR_DEFAULT.hintFallback);
    details.hidden = true;
    desc.textContent = '';
    on.textContent = '';
    off.textContent = '';
    return;
  }
  title.textContent = entry.title || uiT(INSPECTOR_DEFAULT.titleKey, INSPECTOR_DEFAULT.titleFallback);
  hint.hidden = true;
  details.hidden = false;
  desc.textContent = entry.desc || '';
  on.textContent = entry.on || '';
  off.textContent = entry.off || '';
}

function initInspectorPanel() {
  const panel = document.getElementById('inspectorPanel');
  if (!panel) return;
  const onHover = (e) => {
    if (inspectorPinned) return;
    const entry = findInspectorEntry(e.target);
    if (entry) showInspectorEntry(entry);
  };
  document.addEventListener('mouseover', onHover, true);
  document.addEventListener('focusin', onHover, true);
  document.addEventListener('mouseout', (e) => {
    if (inspectorPinned) return;
    const rel = e.relatedTarget;
    if (!rel || !findInspectorEntry(rel)) showInspectorEntry(null);
  }, true);
  document.addEventListener('focusout', (e) => {
    if (inspectorPinned) return;
    const rel = e.relatedTarget;
    if (!rel || !findInspectorEntry(rel)) showInspectorEntry(null);
  }, true);
  document.addEventListener('click', (e) => {
    const entry = findInspectorEntry(e.target);
    if (entry) {
      inspectorPinned = true;
      showInspectorEntry(entry);
      return;
    }
    if (!panel.contains(e.target)) {
      inspectorPinned = false;
      showInspectorEntry(null);
    }
  }, true);
  panel.addEventListener('mouseleave', () => {
    if (!inspectorPinned) showInspectorEntry(null);
  });
  showInspectorEntry(null);
}

function initTtsPipelineControls() {
  document.querySelectorAll('#ttsPipelineSwitch .pipeline-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pipeline = normalizeTtsPipeline(btn.dataset.pipeline);
      try {
        await setTtsPipeline(pipeline, { silentFlash: false, persist: true });
      } catch (_) {}
    });
  });
  updateTtsPipelineSwitchControl(selectedTtsPipeline, { ready: true });
}

function setSummaryText(node, text) {
  if (!node) {
    return;
  }
  const value = String(text ?? '');
  node.textContent = value;
  node.title = value;
}

function updateModeSwitchControl(currentMode, { ready = true } = {}) {
  const modeSwitchEl = document.getElementById('modeSwitch');
  if (!modeSwitchEl) {
    return;
  }
  document.querySelectorAll('#modeSwitch .mode-btn').forEach((btn) => {
    btn.classList.toggle('active', ready && btn.dataset.mode === currentMode);
    btn.disabled = !ready;
    btn.setAttribute('aria-disabled', ready ? 'false' : 'true');
  });
  modeSwitchEl.dataset.active = ready ? currentMode : '';
  modeSwitchEl.dataset.ready = ready ? 'true' : 'false';
  if (!ready) {
    modeSwitchEl.style.removeProperty('--indicator-left');
    modeSwitchEl.style.removeProperty('--indicator-width');
    return;
  }
  const activeBtn = modeSwitchEl.querySelector('.mode-btn.active');
  if (activeBtn) {
    const sr = modeSwitchEl.getBoundingClientRect();
    const br = activeBtn.getBoundingClientRect();
    modeSwitchEl.style.setProperty('--indicator-left', `${br.left - sr.left}px`);
    modeSwitchEl.style.setProperty('--indicator-width', `${br.width}px`);
  }
}

let _modeSwitchResizeObserver = null;
function initModeSwitchObserver() {
  const modeSwitchEl = document.getElementById('modeSwitch');
  if (!modeSwitchEl || typeof ResizeObserver === 'undefined' || _modeSwitchResizeObserver) {
    return;
  }
  let raf = 0;
  _modeSwitchResizeObserver = new ResizeObserver(() => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      raf = 0;
      const ready = modeSwitchEl.dataset.ready === 'true';
      if (ready && modeSwitchEl.dataset.active) {
        updateModeSwitchControl(modeSwitchEl.dataset.active);
      }
    });
  });
  _modeSwitchResizeObserver.observe(modeSwitchEl);
  window.addEventListener('resize', () => {
    const ready = modeSwitchEl.dataset.ready === 'true';
    if (ready && modeSwitchEl.dataset.active) {
      updateModeSwitchControl(modeSwitchEl.dataset.active);
    }
  }, { passive: true });
}

function updateSummaryMode(currentMode) {
  const summaryNode = document.getElementById('summaryText');
  if (!summaryNode) {
    return;
  }
  if (latestStatus) {
    setSummaryText(summaryNode, buildStatusSummaryText({
      ...latestStatus,
      mode: currentMode,
    }));
    return;
  }
  setSummaryText(summaryNode, uiTf('ui.summary.mode_part', 'Режим: {mode}', {
    mode: modeLabel(currentMode, currentMode),
  }));
}

function clearPendingModeSelection(mode) {
  if (!pendingModeSelection || (mode && pendingModeSelection !== mode)) {
    return;
  }
  pendingModeSelection = '';
  if (latestStatus) {
    renderStatus(latestStatus);
  }
}

function renderStatus(status) {
  latestStatus = status;
  const statusMode = status.mode || 'companion';
  if (pendingModeSelection && statusMode === pendingModeSelection) {
    pendingModeSelection = '';
  }
  const currentMode = pendingModeSelection || statusMode;
  syncSettingsValue('modeSelect', currentMode);
  syncSettingsChecked('pushToggle', Boolean(status.push_notifications));
  syncSettingsValue('advanceSpeedSelect', status.advance_speed || 'medium');
  setSummaryText(document.getElementById('summaryText'), buildStatusSummaryText({
    ...status,
    mode: currentMode,
  }));
  updateModeSwitchControl(currentMode);
  updateTtsPipelineSwitchControl(normalizeTtsPipeline(status.tts_output_pipeline || selectedTtsPipeline || 'agent'));
  const currentSpeed = status.advance_speed || 'medium';
  document.querySelectorAll('#speedSwitch .speed-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.speed === currentSpeed);
  });
  document.querySelector('.hero').classList.toggle('mode-auto', currentMode === 'choice_advisor');
  syncSettingsValue('readerModeSelect', status.reader_mode || 'auto');
  const ocrPollIntervalInput = document.getElementById('ocrPollIntervalInput');
  if (ocrPollIntervalInput && !shouldPreserveSettingsControls()) {
    const interval = Number(status.ocr_reader_poll_interval_seconds || 0.5);
    ocrPollIntervalInput.value = Number.isFinite(interval) ? interval.toFixed(1) : '0.5';
  }
  syncSettingsValue('ocrTriggerModeSelect', status.ocr_reader_trigger_mode || 'interval');
  syncSettingsChecked('llmVisionToggle', Boolean(status.llm_vision_enabled));
  syncSettingsChecked('fastLoopToggle', Boolean(status.ocr_fast_loop_enabled));
  const llmVisionMaxInput = document.getElementById('llmVisionMaxImagePxInput');
  if (llmVisionMaxInput && !shouldPreserveSettingsControls()) {
    llmVisionMaxInput.value = String(Number(status.llm_vision_max_image_px || 768));
  }

  const memoryReaderRuntime = status.memory_reader_runtime || {};
  const ocrRuntime = status.ocr_reader_runtime || {};
  const rapidocr = status.rapidocr || {};
  const dxcam = status.dxcam || {};
  const textractor = status.textractor || {};
  const performance = status.performance || {};

  const memoryReaderProcess = memoryReaderRuntime.process_name
    ? `${memoryReaderRuntime.process_name} (${memoryReaderRuntime.pid || 0})`
    : '';
  const ocrTarget = ocrRuntime.process_name
    ? `${ocrRuntime.process_name} (${ocrRuntime.pid || 0})`
    : '';
  const performanceProcess = performance.process_name
    ? `${performance.process_name} (${performance.pid || 0})`
    : String(performance.pid || '');
  const ocrTickAllowed = statusBoolValue(status.ocr_tick_allowed, ocrRuntime.ocr_tick_allowed);
  const ocrReaderAllowed = statusBoolValue(status.ocr_reader_allowed, ocrRuntime.ocr_reader_allowed);
  const ocrWaitingForAdvance = statusBoolValue(
    status.ocr_waiting_for_advance,
    ocrRuntime.ocr_waiting_for_advance,
  );
  const ocrTickBlockReason = textValue(status.ocr_tick_block_reason || ocrRuntime.ocr_tick_block_reason);
  const ocrEmitBlockReason = textValue(status.ocr_emit_block_reason || ocrRuntime.ocr_emit_block_reason);
  const ocrReaderAllowedBlockReason = textValue(
    status.ocr_reader_allowed_block_reason || ocrRuntime.ocr_reader_allowed_block_reason,
  );
  const ocrTriggerModeEffective = textValue(
    status.ocr_trigger_mode_effective || ocrRuntime.ocr_trigger_mode_effective || status.ocr_reader_trigger_mode,
  );
  const ocrWaitingForAdvanceReason = textValue(
    status.ocr_waiting_for_advance_reason || ocrRuntime.ocr_waiting_for_advance_reason,
  );
  const ocrTickGateAllowed = statusBoolValue(status.ocr_tick_gate_allowed, ocrRuntime.ocr_tick_gate_allowed);
  const ocrReaderManagerAvailable = statusBoolValue(
    status.ocr_reader_manager_available,
    ocrRuntime.ocr_reader_manager_available,
  );
  const ocrTickSkippedReason = textValue(status.ocr_tick_skipped_reason || ocrRuntime.ocr_tick_skipped_reason);
  const pendingOcrAdvanceCapture = statusBoolValue(
    status.pending_ocr_advance_capture,
    ocrRuntime.pending_ocr_advance_capture,
  );
  const pendingManualForegroundOcrCapture = statusBoolValue(
    status.pending_manual_foreground_ocr_capture,
    ocrRuntime.pending_manual_foreground_ocr_capture,
  );
  const pendingOcrDelayRemaining = status.pending_ocr_delay_remaining ?? ocrRuntime.pending_ocr_delay_remaining;
  const pendingOcrAdvanceAgeSeconds = (
    status.pending_ocr_advance_capture_age_seconds
    ?? ocrRuntime.pending_ocr_advance_capture_age_seconds
  );
  const pendingOcrAdvanceReason = textValue(
    status.pending_ocr_advance_reason || ocrRuntime.pending_ocr_advance_reason,
  );
  const pendingOcrAdvanceClearReason = textValue(
    status.pending_ocr_advance_clear_reason || ocrRuntime.pending_ocr_advance_clear_reason,
  );
  const foregroundRefreshAttempted = statusBoolValue(
    status.foreground_refresh_attempted,
    ocrRuntime.foreground_refresh_attempted,
  );
  const foregroundRefreshSkippedReason = textValue(
    status.foreground_refresh_skipped_reason || ocrRuntime.foreground_refresh_skipped_reason,
  );
  const ocrLastTickDecisionAt = textValue(
    status.ocr_last_tick_decision_at || ocrRuntime.ocr_last_tick_decision_at,
  );
  const ocrRuntimeStatus = textValue(status.ocr_runtime_status || ocrRuntime.ocr_runtime_status);
  const displaySourceNotOcrReason = textValue(
    status.display_source_not_ocr_reason || ocrRuntime.display_source_not_ocr_reason,
  );
  const ocrBackgroundStatus = status.ocr_background_status || {};
  const ocrBackgroundState = textValue(status.ocr_background_state || ocrBackgroundStatus.state);
  const ocrBackgroundMessage = textValue(status.ocr_background_message || ocrBackgroundStatus.message);

  const rapidocrModelsState = getInstallState('rapidocr_models');
  if (
    rapidocr.installed
    && rapidocr.detail !== 'missing_model_files'
    && rapidocrModelsState.state
    && isInstallTaskTerminal(rapidocrModelsState.state)
  ) {
    rapidocrModelsState.state = null;
    rapidocrModelsState.inProgress = false;
    clearPersistedInstallTaskId('rapidocr_models');
    closeInstallStream('rapidocr_models');
    clearInstallReconnectTimer('rapidocr_models');
  }

  renderPrimaryDiagnosis(status);
  renderFirstRunGuide(status);
  renderCurrentLineOverview(status);
  renderOcrPipelinePanel(status);
  renderInstallCompactSummary(status);

  const diagnosisEl = document.getElementById('primaryDiagnosisPanel');
  if (diagnosisEl) {
    diagnosisEl.classList.toggle('compact', status.primary_diagnosis_level === 'ok');
  }

  const suggestSection = document.getElementById('suggestPanelSection');
  const suggestPanel = document.getElementById('suggestPanel');
  if (suggestSection && suggestPanel) {
    const noDataText = uiT('ui.empty.no_data', 'Нет данных');
    const hasContent = suggestPanel.textContent.trim() && suggestPanel.textContent.trim() !== noDataText;
    suggestSection.hidden = !hasContent;
  }

  const userStatusRows = [
    { label: 'connection_state', value: status.connection_state || '' },
    { label: 'active_data_source', value: status.active_data_source || '' },
    { label: 'reader_mode', value: readerModeLabel(status.reader_mode, status.reader_mode || 'auto') },
    { label: 'mode', value: status.mode || '' },
    {
      label: 'agent_user_status',
      value: agentUserStatusLabel(status.agent_user_status, status.agent_user_status || ''),
    },
    { label: 'agent_pause_message', value: status.agent_pause_message || '' },
    { label: 'push_notifications', value: String(Boolean(status.push_notifications)) },
    { label: 'advance_speed', value: advanceSpeedLabel(status.advance_speed, status.advance_speed || 'medium') },
    { label: 'bound_game_id', value: status.bound_game_id || uiT('ui.common.auto_value', '(auto)') },
    { label: 'available_game_ids', value: (status.available_game_ids || []).join(', ') || uiT('ui.common.none_value', '(none)') },
    { label: 'character_mode', value: status.character_mode || 'off' },
    { label: 'character_fixed_name', value: status.character_fixed_name || '' },
    { label: 'character_profile_count', value: String(status.character_profile_count || 0) },
    { label: 'performance_cpu_percent', value: `${formatFixedNumber(performance.cpu_percent, 1)}%` },
    { label: 'performance_memory_mb', value: `${formatFixedNumber(performance.memory_mb, 1)} MB` },
    { label: 'ocr_reader_enabled', value: String(Boolean(status.ocr_reader_enabled)) },
    { label: 'ocr_poll_interval_seconds', value: String(status.ocr_reader_poll_interval_seconds || '') },
    { label: 'ocr_trigger_mode', value: formatOcrTriggerMode(status.ocr_reader_trigger_mode || 'interval') },
    { label: 'ocr_trigger_mode_effective', value: formatOcrTriggerMode(ocrTriggerModeEffective || 'interval') },
    { label: 'ocr_background_state', value: formatOcrBackgroundState(ocrBackgroundState) },
    { label: 'ocr_background_message', value: ocrBackgroundMessage },
    { label: 'ocr_reader_allowed', value: String(ocrReaderAllowed) },
    { label: 'ocr_reader_allowed_block_reason', value: formatOcrTickBlockReason(ocrReaderAllowedBlockReason) },
    { label: 'ocr_reader_manager_available', value: String(ocrReaderManagerAvailable) },
    { label: 'ocr_runtime_status', value: ocrRuntimeStatus },
    { label: 'ocr_tick_gate_allowed', value: String(ocrTickGateAllowed) },
    { label: 'ocr_tick_allowed', value: String(ocrTickAllowed) },
    { label: 'ocr_tick_block_reason', value: formatOcrTickBlockReason(ocrTickBlockReason) },
    { label: 'ocr_tick_skipped_reason', value: formatOcrTickBlockReason(ocrTickSkippedReason) },
    { label: 'ocr_emit_block_reason', value: formatOcrEmitBlockReason(ocrEmitBlockReason) },
    { label: 'ocr_waiting_for_advance', value: String(ocrWaitingForAdvance) },
    { label: 'ocr_waiting_for_advance_reason', value: formatOcrTickBlockReason(ocrWaitingForAdvanceReason) },
    { label: 'pending_ocr_advance_capture', value: String(pendingOcrAdvanceCapture) },
    { label: 'pending_manual_foreground_ocr_capture', value: String(pendingManualForegroundOcrCapture) },
    { label: 'pending_ocr_delay_remaining', value: formatOcrRuntimeSeconds(pendingOcrDelayRemaining) },
    { label: 'pending_ocr_advance_capture_age_seconds', value: formatOcrRuntimeSeconds(pendingOcrAdvanceAgeSeconds) },
    { label: 'pending_ocr_advance_reason', value: pendingOcrAdvanceReason },
    { label: 'pending_ocr_advance_clear_reason', value: formatOcrTickBlockReason(pendingOcrAdvanceClearReason) },
    { label: 'foreground_refresh_attempted', value: String(foregroundRefreshAttempted) },
    { label: 'foreground_refresh_skipped_reason', value: formatOcrTickBlockReason(foregroundRefreshSkippedReason) },
    { label: 'ocr_last_tick_decision_at', value: ocrLastTickDecisionAt },
    { label: 'display_source_not_ocr_reason', value: displaySourceNotOcrReason },
    { label: 'ocr_reader_status', value: ocrRuntime.status || '' },
    { label: 'ocr_reader_detail', value: ocrRuntime.detail || '' },
    { label: 'ocr_context_state', value: ocrRuntime.ocr_context_state || '' },
    { label: 'screen_type', value: status.screen_type || '' },
    { label: 'screen_confidence', value: formatFixedNumber(status.screen_confidence, 2) },
    { label: 'screen_ui_elements', value: String((status.screen_ui_elements || []).length || 0) },
    { label: 'target_is_foreground', value: String(Boolean(ocrRuntime.target_is_foreground)) },
    { label: 'target_window_visible', value: String(Boolean(status.target_window_visible ?? ocrRuntime.target_window_visible)) },
    { label: 'target_window_minimized', value: String(Boolean(status.target_window_minimized ?? ocrRuntime.target_window_minimized)) },
    { label: 'ocr_window_capture_eligible', value: String(Boolean(status.ocr_window_capture_eligible ?? ocrRuntime.ocr_window_capture_eligible)) },
    { label: 'ocr_window_capture_available', value: String(Boolean(status.ocr_window_capture_available ?? ocrRuntime.ocr_window_capture_available)) },
    { label: 'ocr_window_capture_block_reason', value: formatOcrTickBlockReason(status.ocr_window_capture_block_reason || ocrRuntime.ocr_window_capture_block_reason) },
    { label: 'input_target_foreground', value: String(Boolean(status.input_target_foreground ?? ocrRuntime.input_target_foreground)) },
    { label: 'input_target_block_reason', value: formatOcrTickBlockReason(status.input_target_block_reason || ocrRuntime.input_target_block_reason) },
    { label: 'effective_current_line', value: status.effective_current_line?.text || '' },
    { label: 'ocr_reader_target', value: ocrTarget || '' },
    { label: 'ocr_backend_selection', value: status.ocr_backend_selection || 'auto' },
    { label: 'ocr_capture_backend_selection', value: status.ocr_capture_backend_selection || 'auto' },
    { label: 'ocr_reader_fast_loop_enabled', value: String(Boolean(status.ocr_reader_fast_loop_enabled)) },
    { label: 'rapidocr_installed', value: String(Boolean(rapidocr.installed)) },
    { label: 'dxcam_installed', value: String(Boolean(dxcam.installed)) },
    { label: 'memory_reader_enabled', value: String(Boolean(status.memory_reader_enabled)) },
    { label: 'memory_reader_status', value: memoryReaderRuntime.status || '' },
    { label: 'memory_reader_process', value: memoryReaderProcess || '' },
    { label: 'memory_reader_engine', value: memoryReaderRuntime.engine || '' },
    { label: 'textractor_installed', value: String(Boolean(textractor.installed)) },
    { label: 'last_error', value: status.last_error?.message || '' },
  ];
  const debugStatusRows = [
    { label: 'agent_pause_kind', value: status.agent_pause_kind || '' },
    { label: 'agent_can_resume_by_button', value: String(Boolean(status.agent_can_resume_by_button)) },
    { label: 'agent_can_resume_by_focus', value: String(Boolean(status.agent_can_resume_by_focus)) },
    { label: 'agent_status', value: status.agent_status || '' },
    { label: 'agent_activity', value: status.agent_activity || '' },
    { label: 'agent_reason', value: status.agent_reason || '' },
    { label: 'agent_diagnostic', value: status.agent_diagnostic || '' },
    { label: 'inbound_queue_size', value: String(status.agent_inbound_queue_size || 0) },
    { label: 'outbound_queue_size', value: String(status.agent_outbound_queue_size || 0) },
    { label: 'active_session_id', value: status.active_session_id || '' },
    { label: 'last_seq', value: String(status.last_seq || 0) },
    { label: 'stream_reset_pending', value: String(Boolean(status.stream_reset_pending)) },
    { label: 'performance_memory_percent', value: `${formatFixedNumber(performance.memory_percent, 2)}%` },
    { label: 'performance_thread_count', value: String(performance.thread_count || 0) },
    { label: 'performance_process', value: performanceProcess || '' },
    { label: 'performance_detail', value: performance.detail || '' },
    { label: 'pending_ocr_advance_captures', value: String(status.pending_ocr_advance_captures || 0) },
    {
      label: 'pending_ocr_advance_capture_age_seconds',
      value: formatFixedNumber(pendingOcrAdvanceAgeSeconds, 1),
    },
    { label: 'last_ocr_advance_capture_reason', value: status.last_ocr_advance_capture_reason || '' },
    { label: 'ocr_background_polling', value: String(Boolean(status.ocr_background_polling || ocrBackgroundStatus.background_polling)) },
    { label: 'ocr_foreground_resume_pending', value: String(Boolean(status.ocr_foreground_resume_pending || ocrBackgroundStatus.foreground_resume_pending)) },
    { label: 'ocr_capture_backend_blocked', value: String(Boolean(status.ocr_capture_backend_blocked || ocrBackgroundStatus.capture_backend_blocked)) },
    { label: 'ocr_capture_diagnostic_required', value: String(Boolean(status.ocr_capture_diagnostic_required)) },
    { label: 'ocr_capture_diagnostic', value: status.ocr_capture_diagnostic || '' },
    { label: 'ocr_last_tick_decision_at', value: ocrLastTickDecisionAt },
    { label: 'ocr_fast_loop_running', value: String(Boolean(status.ocr_fast_loop_running)) },
    { label: 'ocr_fast_loop_last_duration_seconds', value: formatFixedNumber(status.ocr_fast_loop_last_duration_seconds, 2) },
    { label: 'ocr_fast_loop_iteration_count', value: String(status.ocr_fast_loop_iteration_count || 0) },
    { label: 'ocr_poll_latency_sample_count', value: String(status.ocr_poll_latency_sample_count || 0) },
    { label: 'ocr_poll_duration_p50_seconds', value: formatFixedNumber(status.ocr_poll_duration_p50_seconds, 2) },
    { label: 'ocr_poll_duration_p95_seconds', value: formatFixedNumber(status.ocr_poll_duration_p95_seconds, 2) },
    { label: 'bridge_poll_latency_sample_count', value: String(status.bridge_poll_latency_sample_count || 0) },
    { label: 'bridge_poll_duration_p50_seconds', value: formatFixedNumber(status.bridge_poll_duration_p50_seconds, 2) },
    { label: 'bridge_poll_duration_p95_seconds', value: formatFixedNumber(status.bridge_poll_duration_p95_seconds, 2) },
    { label: 'ocr_auto_degrade_count', value: String(status.ocr_auto_degrade_count || 0) },
    { label: 'ocr_auto_degrade_reason', value: status.ocr_auto_degrade_reason || '' },
    { label: 'candidate_age_seconds', value: formatFixedNumber(status.candidate_age_seconds, 1) },
    { label: 'stable_confirm_wait_seconds', value: formatFixedNumber(status.stable_confirm_wait_seconds, 1) },
    { label: 'ocr_backend_kind', value: ocrRuntime.backend_kind || '' },
    { label: 'ocr_backend_detail', value: ocrRuntime.backend_detail || '' },
    { label: 'screen_text_sources', value: (status.screen_debug?.sources || []).join(', ') || '' },
    { label: 'screen_classify_reason', value: status.screen_debug?.reason || '' },
    { label: 'screen_classify_layout', value: JSON.stringify(status.screen_debug?.layout || {}) },
    { label: 'screen_classify_keywords', value: JSON.stringify(status.screen_debug?.keyword_hits || {}) },
    { label: 'llm_vision_enabled', value: String(Boolean(status.llm_vision_enabled)) },
    { label: 'llm_vision_max_image_px', value: String(status.llm_vision_max_image_px || 0) },
    { label: 'vision_snapshot_available', value: String(Boolean(ocrRuntime.vision_snapshot_available)) },
    { label: 'vision_snapshot_captured_at', value: ocrRuntime.vision_snapshot_captured_at || '' },
    { label: 'vision_snapshot_byte_size', value: String(ocrRuntime.vision_snapshot_byte_size || 0) },
    { label: 'ocr_screen_awareness_full_frame_ocr', value: String(Boolean(status.ocr_screen_awareness_full_frame_ocr)) },
    { label: 'ocr_screen_awareness_multi_region_ocr', value: String(Boolean(status.ocr_screen_awareness_multi_region_ocr)) },
    { label: 'ocr_screen_awareness_visual_rules', value: String(Boolean(status.ocr_screen_awareness_visual_rules)) },
    { label: 'ocr_screen_awareness_latency_mode', value: status.ocr_screen_awareness_latency_mode || '' },
    {
      label: 'ocr_screen_awareness_min_interval_seconds',
      value: formatFixedNumber(status.ocr_screen_awareness_min_interval_seconds, 1),
    },
    { label: 'rapidocr_enabled', value: String(Boolean(status.rapidocr_enabled)) },
    { label: 'rapidocr_detail', value: rapidocr.detail || '' },
    { label: 'dxcam_detail', value: dxcam.detail || '' },
    { label: 'memory_reader_detail', value: memoryReaderRuntime.detail || '' },
    { label: 'memory_reader_target_selection_detail', value: memoryReaderRuntime.target_selection_detail || '' },
    { label: 'memory_reader_detection_reason', value: memoryReaderRuntime.detection_reason || '' },
    { label: 'memory_reader_hook_code_count', value: String(memoryReaderRuntime.hook_code_count || 0) },
    { label: 'memory_reader_hook_code_detail', value: memoryReaderRuntime.hook_code_detail || '' },
    { label: 'last_text_seq', value: String(memoryReaderRuntime.last_text_seq || 0) },
    { label: 'last_text_ts', value: memoryReaderRuntime.last_text_ts || '' },
    { label: 'last_text_recent', value: String(Boolean(memoryReaderRuntime.last_text_recent)) },
    { label: 'last_text_age_seconds', value: formatFixedNumber(memoryReaderRuntime.last_text_age_seconds, 1) },
    { label: 'textractor_detail', value: textractor.detail || '' },
  ];
  renderStatusGrid(userStatusRows, debugStatusRows);

  renderOcrRuntime(status);
  renderSnapshotGridFromLatestData();
  renderAgentUserNotice(status);
  syncAgentResumeButton(status);
  syncAutoRefreshIntervalForStatus(status);
  renderRapidOcr(status);
  renderDxcam(status);
  renderTextractor(status);
  renderMemoryReaderTargetStatus(status);
  renderOcrWindowTargetStatus(status);
  renderOcrProfile(status);
  renderCharacterProfilePanel(status);
  renderGameBinding(status);
}

function renderGameBinding(status) {
  const currentNode = document.getElementById('currentBoundGameId');
  const detailNode = document.getElementById('currentBoundGameDetail');
  const listNode = document.getElementById('availableGameIds');
  if (!currentNode || !listNode) {
    return;
  }

  const boundGameId = String(status.bound_game_id || '').trim();
  const gameIds = Array.isArray(status.available_game_ids) ? status.available_game_ids : [];
  const boundDescription = describeGameBindingId(boundGameId);
  currentNode.textContent = boundGameId
    ? uiTf('ui.game.binding.fixed_title', 'Зафиксировано: {title}', { title: boundDescription.title })
    : uiT('ui.game.binding.auto_title', 'Автовыбор окна игры');
  if (detailNode) {
    detailNode.textContent = boundGameId
      ? uiTf('ui.game.binding.fixed_detail', '{detail}. После нажатия «Восстановить авто» плагин снова выберет из доступных целей.', { detail: boundDescription.detail })
      : uiT('ui.game.binding.auto_detail', 'Плагин предпочитает текущую доступную цель. Чтобы зафиксировать цель, нажмите кандидата ниже.');
  }

  if (!gameIds.length) {
    listNode.className = 'binding-chip-row empty-inline';
    listNode.textContent = uiT('ui.game.binding.no_games', 'Игра для привязки не найдена. Проверьте, что Bridge/OCR/Memory Reader подключен к окну игры.');
    return;
  }

  const normalizedGameIds = gameIds.map((gameId) => String(gameId || '').trim()).filter(Boolean);
  if (!normalizedGameIds.length) {
    listNode.className = 'binding-chip-row empty-inline';
    listNode.textContent = uiT('ui.game.binding.empty_ids', 'Список доступных ID игр пуст.');
    return;
  }

  listNode.className = 'binding-chip-row';
  listNode.replaceChildren(
    ...normalizedGameIds
      .map((normalized) => {
        const active = normalized === boundGameId;
        const description = describeGameBindingId(normalized);
        const button = document.createElement('button');
        button.className = `binding-chip${active ? ' active' : ''}`;
        button.dataset.gameId = normalized;
        button.disabled = active;
        const title = document.createElement('span');
        title.className = 'binding-chip-title';
        title.textContent = active
          ? uiTf('ui.game.binding.current_title', 'Текущее: {title}', { title: description.title })
          : description.title;
        const detail = document.createElement('span');
        detail.className = 'binding-chip-detail';
        detail.textContent = description.detail;
        button.replaceChildren(title, detail);
        return button;
      }),
  );

  listNode.querySelectorAll('[data-game-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const gameId = button.getAttribute('data-game-id') || '';
      withButtonPending(button, uiT('ui.pending.binding', 'Привязка...'), () => bindGame(gameId)).catch((error) => { console.error('[galgame] async action failed', error); });
    });
  });
}

function describeGameBindingId(gameId) {
  const normalized = String(gameId || '').trim();
  if (!normalized) {
    return {
      title: uiT('ui.game.binding.auto_title', 'Автовыбор окна игры'),
      detail: uiT('ui.game.binding.auto_short_detail', 'Плагин предпочитает текущую доступную цель'),
    };
  }
  const [prefix, ...rest] = normalized.split('-');
  const suffix = rest.join('-') || normalized;
  if (prefix === 'mem') {
    return {
      title: uiT('ui.game.binding.memory_target', 'Цель Memory Reader'),
      detail: `ID ${suffix}`,
    };
  }
  if (prefix === 'ocr') {
    return {
      title: uiT('ui.game.binding.ocr_target', 'Цель OCR-окна'),
      detail: `ID ${suffix}`,
    };
  }
  return {
    title: uiT('ui.game.binding.game_target', 'Цель игры'),
    detail: normalized,
  };
}

function normalizeCharacterProfileSnapshot(payload = {}, status = latestStatus) {
  const characters = Array.isArray(payload.characters)
    ? payload.characters
      .map((item) => ({
        name: String(item?.name || '').trim(),
        identity: String(item?.identity || '').trim(),
      }))
      .filter((item) => item.name)
    : [];
  return {
    game_id: String(
      payload.profile_game_id
      || payload.game_id
      || status?.character_profile_game_id
      || status?.bound_game_id
      || '',
    ).trim(),
    profile_game_id: String(payload.profile_game_id || status?.character_profile_game_id || '').trim(),
    match_reason: String(payload.match_reason || status?.character_profile_match_reason || '').trim(),
    characters,
    summary: String(payload.summary || ''),
    degraded: Boolean(payload.degraded),
    diagnostic: String(payload.diagnostic || ''),
  };
}

function selectedCharacterNameFromPanel(characters) {
  const select = document.getElementById('characterProfileSelect');
  if (!select) {
    return '';
  }
  const current = String(select.value || '').trim();
  return current && characters.some((item) => item.name === current) ? current : '';
}

function characterProfileRefreshKeyForStatus(status = latestStatus) {
  const ocrRuntime = status?.ocr_reader_runtime && typeof status.ocr_reader_runtime === 'object'
    ? status.ocr_reader_runtime
    : {};
  const memoryRuntime = status?.memory_reader_runtime && typeof status.memory_reader_runtime === 'object'
    ? status.memory_reader_runtime
    : {};
  return [
    status?.character_profile_game_id,
    status?.bound_game_id,
    status?.active_game_id,
    ocrRuntime.game_id,
    ocrRuntime.effective_process_name || ocrRuntime.process_name,
    ocrRuntime.effective_window_title || ocrRuntime.window_title,
    memoryRuntime.game_id,
    memoryRuntime.process_name,
  ].map((item) => String(item || '').trim()).join('|');
}

function renderCharacterProfilePanel(status = latestStatus, snapshot = latestCharacterProfileSnapshot) {
  const statusNode = document.getElementById('characterProfileStatusText');
  const hintNode = document.getElementById('characterProfileHint');
  const select = document.getElementById('characterProfileSelect');
  const fixedButton = document.getElementById('characterProfileFixedBtn');
  const offButton = document.getElementById('characterProfileOffBtn');
  const refreshButton = document.getElementById('characterProfileRefreshBtn');
  if (!statusNode || !hintNode || !select || !fixedButton || !offButton || !refreshButton) {
    return;
  }

  const mode = String(status?.character_mode || 'off').trim() || 'off';
  const fixedName = String(status?.character_fixed_name || '').trim();
  const boundGameId = String(status?.bound_game_id || '').trim();
  const profileGameId = String(status?.character_profile_game_id || snapshot?.profile_game_id || '').trim();
  const targetKey = characterProfileRefreshKeyForStatus(status);
  const hasRuntimeTarget = targetKey.split('|').some((item) => item.trim());
  const profileKey = profileGameId || boundGameId;
  const displayKey = profileKey || (hasRuntimeTarget ? targetKey : '');
  const matchReason = String(status?.character_profile_match_reason || snapshot?.match_reason || '').trim();
  const snapshotGameId = String(snapshot?.game_id || '').trim();
  const characters = profileKey && (!snapshotGameId || snapshotGameId === profileKey) && Array.isArray(snapshot?.characters)
    ? snapshot.characters
    : [];
  const characterCount = characters.length || Number(status?.character_profile_count || 0);
  const existingSelection = selectedCharacterNameFromPanel(characters);
  const preferredName = fixedName && characters.some((item) => item.name === fixedName)
    ? fixedName
    : existingSelection;
  const nextSelection = preferredName || (characters[0]?.name || '');

  if (mode === 'fixed' && fixedName) {
    statusNode.textContent = uiTf('ui.character_profile.status_fixed', 'Фиксированный персонаж: {name}', { name: fixedName });
  } else if (!displayKey || (!characters.length && snapshot && !characterCount)) {
    statusNode.textContent = uiT('ui.character_profile.status_unavailable', 'Нет доступных профилей');
  } else {
    statusNode.textContent = uiT('ui.character_profile.status_off', 'Отключено');
  }

  if (!characters.length) {
    select.replaceChildren(new Option(
      displayKey
        ? uiT('ui.character_profile.select_placeholder', 'Ожидание списка персонажей')
        : uiT('ui.character_profile.no_game_option', 'Сначала привяжите игру'),
      '',
    ));
  } else {
    const options = characters.map((item) => {
      const label = item.identity
        ? uiTf('ui.character_profile.option_with_identity', '{name} - {identity}', {
          name: item.name,
          identity: item.identity,
        })
        : item.name;
      return new Option(label, item.name);
    });
    select.replaceChildren(...options);
    select.value = nextSelection;
  }

  if (!displayKey) {
    hintNode.textContent = uiT('ui.character_profile.hint_no_game', 'Сначала привяжите или обнаружьте игровую цель в разделе распознавания.');
  } else if (snapshot?.diagnostic) {
    hintNode.textContent = uiTf('ui.character_profile.hint_load_failed', 'Не удалось загрузить список персонажей: {error}', {
      error: snapshot.diagnostic,
    });
  } else if (!snapshot) {
    hintNode.textContent = uiT('ui.character_profile.status_waiting', 'Ожидание обновления статуса');
  } else if (!characters.length) {
    hintNode.textContent = uiT('ui.character_profile.hint_no_profiles', 'Для текущей игры нет доступных профилей персонажей.');
  } else {
    const loadedText = uiTf('ui.character_profile.hint_loaded', 'Загружено профилей персонажей: {count}.', {
      count: characters.length,
    });
    hintNode.textContent = profileGameId && matchReason && !boundGameId
      ? `${loadedText} ${uiTf('ui.character_profile.hint_auto_matched', 'Подобран профиль: {game}', { game: profileGameId })}`
      : loadedText;
  }

  const selectedName = String(select.value || '').trim();
  fixedButton.disabled = !displayKey || !characters.length || !selectedName;
  offButton.disabled = mode === 'off' && !fixedName;
  refreshButton.disabled = Boolean(characterProfileRefreshInFlight);
}

function shouldRefreshCharacterProfilesForStatus(status) {
  const profileKey = characterProfileRefreshKeyForStatus(status);
  if (!latestCharacterProfileSnapshot) {
    return true;
  }
  if (profileKey !== lastCharacterProfileGameId) {
    return true;
  }
  if (latestCharacterProfileSnapshot.degraded) {
    return true;
  }
  if (Date.now() - lastCharacterProfileRefreshAt > CHARACTER_PROFILE_REFRESH_TTL_MS) {
    return true;
  }
  const statusCount = Number(status?.character_profile_count || 0);
  const snapshotCount = Array.isArray(latestCharacterProfileSnapshot.characters)
    ? latestCharacterProfileSnapshot.characters.length
    : 0;
  return statusCount !== snapshotCount;
}

function refreshCharacterProfiles({ force = false, silent = true } = {}) {
  if (characterProfileRefreshInFlight) {
    return characterProfileRefreshInFlight;
  }

  const refreshKey = characterProfileRefreshKeyForStatus(latestStatus);
  const profileKey = String(
    latestStatus?.character_profile_game_id || latestStatus?.bound_game_id || '',
  ).trim();

  const now = Date.now();
  if (
    !force
    && refreshKey === lastCharacterProfileGameId
    && now - lastCharacterProfileRefreshAt < CHARACTER_PROFILE_REFRESH_TTL_MS
  ) {
    renderCharacterProfilePanel(latestStatus);
    return Promise.resolve(false);
  }

  characterProfileRefreshInFlight = callPlugin('galgame_get_character_list', {}, {
    timeoutMs: PLUGIN_RUN_LIGHT_TIMEOUT_MS,
  }).then((payload) => {
    latestCharacterProfileSnapshot = normalizeCharacterProfileSnapshot(payload, latestStatus);
    lastCharacterProfileGameId = refreshKey;
    lastCharacterProfileRefreshAt = Date.now();
    renderCharacterProfilePanel(latestStatus);
    return true;
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    lastCharacterProfileGameId = refreshKey;
    lastCharacterProfileRefreshAt = Date.now();
    latestCharacterProfileSnapshot = normalizeCharacterProfileSnapshot({
      game_id: profileKey,
      characters: [],
      degraded: true,
      diagnostic: message,
    }, latestStatus);
    renderCharacterProfilePanel(latestStatus);
    if (!silent) {
      setFlash(message, 'error');
    }
    return false;
  }).finally(() => {
    characterProfileRefreshInFlight = null;
    renderCharacterProfilePanel(latestStatus);
  });
  renderCharacterProfilePanel(latestStatus);
  return characterProfileRefreshInFlight;
}

async function setCharacterProfileMode(mode) {
  const normalized = String(mode || '').trim();
  const select = document.getElementById('characterProfileSelect');
  const characterName = String(select?.value || '').trim();
  if (normalized === 'fixed' && !characterName) {
    throw new Error(uiT('ui.character_profile.error_select_required', 'Сначала выберите персонажа.'));
  }
  const args = normalized === 'fixed'
    ? { mode: 'fixed', character_name: characterName }
    : { mode: 'off' };
  setFlash(uiT('ui.flash.saving_character_mode', 'Сохранение настроек профиля персонажа...'), 'info');
  const payload = await callPlugin('galgame_set_character_mode', args);
  setFlash(payload.summary || uiT('ui.flash.character_mode_saved', 'Настройки профиля персонажа сохранены'), 'success');
  await refreshAll({ preserveFlash: true, forceInsights: true, forceRefresh: true });
  await refreshCharacterProfiles({ force: true, silent: true });
}

function formatConnectionStateZh(value) {
  const normalized = String(value || '').trim();
  return connectionStateLabel(normalized, normalized || uiT('ui.common.unknown', 'Неизвестно'));
}

function formatModeZh(value) {
  const normalized = String(value || '').trim();
  return modeLabel(normalized, normalized || uiT('ui.common.unknown_mode', 'Неизвестный режим'));
}

function formatDataSourceZh(value) {
  const normalized = String(value || '').trim();
  return dataSourceLabel(normalized, normalized || uiT('ui.common.unknown_source', 'Неизвестный источник'));
}

function buildStatusSummaryText(status) {
  if (!status || typeof status !== 'object') {
    return uiT('ui.summary.none', 'Нет сводки');
  }

  const source = String(status.active_data_source || '').trim();
  const sessionId = String(status.active_session_id || '').trim();
  const boundGameId = String(status.bound_game_id || '').trim();
  const connectionState = formatConnectionStateZh(status.connection_state);
  const mode = formatModeZh(status.mode);
  const lastSeq = String(status.last_seq || 0);
  const warningMessage = typeof status.last_error?.message === 'string'
    ? status.last_error.message.trim()
    : '';

  let prefix = '';
  if (source === 'ocr_reader' && sessionId) {
    prefix = uiT('ui.summary.connected_ocr', 'Подключено через OCR (резервный режим)');
  } else if (source === 'memory_reader' && sessionId) {
    prefix = uiT('ui.summary.connected_memory', 'Подключено через чтение памяти (резервный режим)');
  } else if (source === 'bridge_sdk' && sessionId) {
    prefix = uiT('ui.summary.connected_bridge', 'Подключено через Bridge SDK');
  } else if (status.connection_state === 'stale') {
    prefix = uiT('ui.summary.stale_snapshot', 'Текущий снимок моста устарел');
  } else if (status.connection_state === 'active') {
    prefix = uiT('ui.summary.bridge_active', 'Мост работает');
  } else {
    prefix = uiTf('ui.summary.current_source', 'Текущий источник: {source}', { source: formatDataSourceZh(source) });
  }

  const ttsPipeline = ttsPipelineLabel(status.tts_output_pipeline || selectedTtsPipeline || 'agent');
  const parts = [
    uiTf('ui.summary.state_part', 'Состояние: {state}', { state: connectionState }),
    uiTf('ui.summary.mode_part', 'Режим: {mode}', { mode }),
    uiTf('ui.summary.tts_part', 'Озвучка: {pipeline}', { pipeline: ttsPipeline }),
  ];

  if (boundGameId) {
    parts.push(uiTf('ui.summary.bound_part', 'Привязка: {gameId}', { gameId: boundGameId }));
  }
  if (sessionId) {
    parts.push(uiTf('ui.summary.session_part', 'Сессия: {sessionId}', { sessionId }));
  }
  parts.push(uiTf('ui.summary.seq_part', 'Последний seq: {seq}', { seq: lastSeq }));

  if (warningMessage) {
    parts.push(uiTf('ui.summary.warning_part', 'Предупреждение: {warning}', { warning: warningMessage }));
  }
  if (status.ocr_capture_diagnostic_required) {
    parts.push(uiTf('ui.summary.ocr_diagnostic_part', 'Диагностика OCR: {diagnostic}', {
      diagnostic: status.ocr_context_state || ocrRuntimeState(status) || uiT('ui.ocr.missing_line.capture_target_abnormal', 'Возможна проблема с областью захвата/окном'),
    }));
  }
  if (status.agent_diagnostic_required || status.agent_reason) {
    const agentText = status.agent_diagnostic || status.agent_reason || status.agent_status || '';
    if (agentText) {
      parts.push(uiTf('ui.summary.agent_part', 'Агент: {agent}', { agent: agentText }));
    }
  }

  return `${prefix}｜${parts.join('｜')}`;
}

function ocrRuntimeState(status) {
  const runtime = status?.ocr_reader_runtime || {};
  return readOcrRuntimeValue(runtime, 'ocr', 'context_state', 'ocr_context_state') || runtime.detail || '';
}

function ocrRuntimeGroup(runtime, groupName) {
  const group = runtime?.[groupName];
  return group && typeof group === 'object' ? group : {};
}

function readOcrRuntimeValue(runtime, groupName, groupKey, legacyKey = groupKey) {
  const group = ocrRuntimeGroup(runtime, groupName);
  const groupedValue = group[groupKey];
  if (groupedValue !== undefined && groupedValue !== null && groupedValue !== '') {
    return groupedValue;
  }
  const legacyValue = runtime?.[legacyKey];
  return legacyValue !== undefined && legacyValue !== null ? legacyValue : '';
}

function formatOcrRuntimeSeconds(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue.toFixed(2) : '';
}

function renderOcrRuntime(status) {
  const runtime = status.ocr_reader_runtime || {};
  const backgroundStatus = status.ocr_background_status || {};
  const fromWindow = (key, legacyKey = key) => readOcrRuntimeValue(runtime, 'window', key, legacyKey);
  const fromCapture = (key, legacyKey = key) => readOcrRuntimeValue(runtime, 'capture', key, legacyKey);
  const fromOcr = (key, legacyKey = key) => readOcrRuntimeValue(runtime, 'ocr', key, legacyKey);
  const fromTiming = (key, legacyKey = key) => readOcrRuntimeValue(runtime, 'timing', key, legacyKey);
  const fromAdvance = (key, legacyKey = key) => readOcrRuntimeValue(runtime, 'advance', key, legacyKey);
  const fromProfile = (key, legacyKey = key) => readOcrRuntimeValue(runtime, 'profile', key, legacyKey);
  const windowTitle = fromWindow('title', 'window_title');
  const captureStage = fromCapture('stage', 'capture_stage');
  const captureProfile = fromCapture('profile', 'capture_profile');
  const captureProfileMatchSource = fromCapture('profile_match_source', 'capture_profile_match_source');
  const lastCaptureStage = fromCapture('last_stage', 'last_capture_stage');
  const lastCaptureProfile = fromCapture('last_profile', 'last_capture_profile');
  renderGrid('ocrRuntimeGrid', [
    { label: 'status', value: runtime.status || '' },
    { label: 'detail', value: runtime.detail || '' },
    { label: 'process_name', value: fromWindow('process_name') || '' },
    { label: 'pid', value: String(fromWindow('pid') || 0) },
    { label: 'window_title', value: windowTitle || '' },
    { label: 'width', value: String(fromWindow('width') || 0) },
    { label: 'height', value: String(fromWindow('height') || 0) },
    { label: 'aspect_ratio', value: fromWindow('aspect_ratio') ? Number(fromWindow('aspect_ratio')).toFixed(4) : '' },
    { label: 'game_id', value: runtime.game_id || '' },
    { label: 'session_id', value: runtime.session_id || '' },
    { label: 'last_seq', value: String(runtime.last_seq || 0) },
    { label: 'last_event_ts', value: runtime.last_event_ts || '' },
    {
      label: 'ocr_background_state',
      value: formatOcrBackgroundState(status.ocr_background_state || backgroundStatus.state),
    },
    { label: 'ocr_background_message', value: status.ocr_background_message || backgroundStatus.message || '' },
    { label: 'ocr_background_polling', value: String(Boolean(status.ocr_background_polling || backgroundStatus.background_polling)) },
    { label: 'ocr_foreground_resume_pending', value: String(Boolean(status.ocr_foreground_resume_pending || backgroundStatus.foreground_resume_pending)) },
    { label: 'ocr_capture_backend_blocked', value: String(Boolean(status.ocr_capture_backend_blocked || backgroundStatus.capture_backend_blocked)) },
    { label: 'capture_stage', value: ocrProfileStageLabel(captureStage, captureStage || uiT('ui.stage.default', 'Общая область')) },
    { label: 'capture_profile', value: formatCaptureProfile(captureProfile) || '(default)' },
    {
      label: 'capture_profile_match_source',
      value: ocrCaptureMatchSourceLabel(captureProfileMatchSource, captureProfileMatchSource || ''),
    },
    { label: 'capture_profile_bucket_key', value: fromCapture('profile_bucket_key', 'capture_profile_bucket_key') || '' },
    {
      label: 'recommended_capture_profile_stage',
      value: ocrProfileStageLabel(fromProfile('recommended_capture_profile_stage'))
        || fromProfile('recommended_capture_profile_stage')
        || '',
    },
    {
      label: 'recommended_capture_profile',
      value: formatCaptureProfile(fromProfile('recommended_capture_profile')) || '',
    },
    {
      label: 'recommended_capture_profile_process_name',
      value: fromProfile('recommended_capture_profile_process_name') || '',
    },
    {
      label: 'recommended_capture_profile_save_scope',
      value: fromProfile('recommended_capture_profile_save_scope') || '',
    },
    { label: 'recommended_capture_profile_reason', value: fromProfile('recommended_capture_profile_reason') || '' },
    {
      label: 'recommended_capture_profile_confidence',
      value: formatFixedNumber(fromProfile('recommended_capture_profile_confidence'), 2),
    },
    {
      label: 'recommended_capture_profile_manual_present',
      value: String(Boolean(fromProfile('recommended_capture_profile_manual_present'))),
    },
    {
      label: 'capture_profile_auto_apply_enabled',
      value: String(Boolean(fromCapture('capture_profile_auto_apply_enabled'))),
    },
    {
      label: 'capture_profile_pending_rollback',
      value: String(Boolean(fromCapture('capture_profile_pending_rollback'))),
    },
    {
      label: 'capture_profile_last_rollback_reason',
      value: fromCapture('capture_profile_last_rollback_reason') || '',
    },
    { label: 'consecutive_no_text_polls', value: String(fromOcr('consecutive_no_text_polls') || 0) },
    { label: 'last_observed_at', value: fromOcr('last_observed_at') || '' },
    { label: 'last_capture_stage', value: ocrProfileStageLabel(lastCaptureStage, lastCaptureStage || '') },
    { label: 'last_capture_profile', value: formatCaptureProfile(lastCaptureProfile) || '' },
    { label: 'ocr_context_state', value: fromOcr('context_state', 'ocr_context_state') || '' },
    { label: 'ocr_tick_gate_allowed', value: String(Boolean(runtime.ocr_tick_gate_allowed)) },
    { label: 'ocr_tick_allowed', value: String(Boolean(runtime.ocr_tick_allowed)) },
    { label: 'ocr_tick_block_reason', value: formatOcrTickBlockReason(runtime.ocr_tick_block_reason) },
    { label: 'ocr_tick_skipped_reason', value: formatOcrTickBlockReason(runtime.ocr_tick_skipped_reason) },
    { label: 'ocr_tick_entered', value: String(Boolean(runtime.ocr_tick_entered)) },
    { label: 'ocr_tick_lock_acquired', value: String(Boolean(runtime.ocr_tick_lock_acquired)) },
    { label: 'ocr_emit_block_reason', value: formatOcrEmitBlockReason(runtime.ocr_emit_block_reason) },
    { label: 'ocr_reader_allowed', value: String(Boolean(runtime.ocr_reader_allowed)) },
    { label: 'ocr_reader_allowed_block_reason', value: formatOcrTickBlockReason(runtime.ocr_reader_allowed_block_reason) },
    { label: 'target_window_visible', value: String(Boolean(fromWindow('target_window_visible'))) },
    { label: 'target_window_minimized', value: String(Boolean(fromWindow('target_window_minimized'))) },
    { label: 'ocr_window_capture_eligible', value: String(Boolean(fromWindow('ocr_window_capture_eligible'))) },
    { label: 'ocr_window_capture_available', value: String(Boolean(fromWindow('ocr_window_capture_available'))) },
    { label: 'ocr_window_capture_block_reason', value: formatOcrTickBlockReason(fromWindow('ocr_window_capture_block_reason')) },
    { label: 'input_target_foreground', value: String(Boolean(fromWindow('input_target_foreground'))) },
    { label: 'input_target_block_reason', value: formatOcrTickBlockReason(fromWindow('input_target_block_reason')) },
    { label: 'ocr_trigger_mode_effective', value: formatOcrTriggerMode(runtime.ocr_trigger_mode_effective || 'interval') },
    { label: 'ocr_waiting_for_advance', value: String(Boolean(runtime.ocr_waiting_for_advance)) },
    { label: 'ocr_waiting_for_advance_reason', value: formatOcrTickBlockReason(runtime.ocr_waiting_for_advance_reason) },
    { label: 'pending_manual_foreground_ocr_capture', value: String(Boolean(runtime.pending_manual_foreground_ocr_capture)) },
    { label: 'pending_ocr_delay_remaining', value: formatOcrRuntimeSeconds(runtime.pending_ocr_delay_remaining) },
    { label: 'pending_ocr_advance_reason', value: runtime.pending_ocr_advance_reason || '' },
    { label: 'pending_ocr_advance_clear_reason', value: formatOcrTickBlockReason(runtime.pending_ocr_advance_clear_reason) },
    { label: 'foreground_refresh_attempted', value: String(Boolean(runtime.foreground_refresh_attempted)) },
    { label: 'foreground_refresh_skipped_reason', value: formatOcrTickBlockReason(runtime.foreground_refresh_skipped_reason) },
    { label: 'ocr_last_tick_decision_at', value: runtime.ocr_last_tick_decision_at || '' },
    { label: 'ocr_fast_loop_delegated', value: String(Boolean(runtime.ocr_fast_loop_delegated)) },
    { label: 'ocr_fast_loop_running', value: String(Boolean(status.ocr_fast_loop_running)) },
    {
      label: 'ocr_fast_loop_inflight_seconds',
      value: formatOcrRuntimeSeconds(status.ocr_fast_loop_inflight_seconds),
    },
    {
      label: 'ocr_fast_loop_last_duration_seconds',
      value: formatOcrRuntimeSeconds(status.ocr_fast_loop_last_duration_seconds),
    },
    { label: 'ocr_fast_loop_iteration_count', value: String(status.ocr_fast_loop_iteration_count || 0) },
    { label: 'ocr_poll_duration_p50_seconds', value: formatOcrRuntimeSeconds(status.ocr_poll_duration_p50_seconds) },
    { label: 'ocr_poll_duration_p95_seconds', value: formatOcrRuntimeSeconds(status.ocr_poll_duration_p95_seconds) },
    { label: 'bridge_poll_duration_p50_seconds', value: formatOcrRuntimeSeconds(status.bridge_poll_duration_p50_seconds) },
    { label: 'bridge_poll_duration_p95_seconds', value: formatOcrRuntimeSeconds(status.bridge_poll_duration_p95_seconds) },
    { label: 'ocr_auto_degrade_reason', value: status.ocr_auto_degrade_reason || '' },
    { label: 'ocr_auto_degrade_at', value: status.ocr_auto_degrade_at || '' },
    { label: 'candidate_age_seconds', value: formatOcrRuntimeSeconds(status.candidate_age_seconds) },
    { label: 'stable_confirm_wait_seconds', value: formatOcrRuntimeSeconds(status.stable_confirm_wait_seconds) },
    { label: 'display_source_not_ocr_reason', value: runtime.display_source_not_ocr_reason || '' },
    { label: 'last_capture_attempt_at', value: fromOcr('last_capture_attempt_at') || '' },
    { label: 'last_capture_completed_at', value: fromOcr('last_capture_completed_at') || '' },
    { label: 'last_capture_error', value: fromOcr('last_capture_error') || '' },
    { label: 'capture_backend_kind', value: fromCapture('backend_kind', 'capture_backend_kind') || '' },
    { label: 'capture_backend_detail', value: fromCapture('backend_detail', 'capture_backend_detail') || '' },
    { label: 'last_capture_image_hash', value: fromCapture('last_image_hash', 'last_capture_image_hash') || '' },
    { label: 'vision_snapshot_available', value: String(Boolean(fromCapture('vision_snapshot_available'))) },
    { label: 'vision_snapshot_captured_at', value: fromCapture('vision_snapshot_captured_at') || '' },
    { label: 'vision_snapshot_expires_at', value: fromCapture('vision_snapshot_expires_at') || '' },
    { label: 'vision_snapshot_source', value: fromCapture('vision_snapshot_source') || '' },
    { label: 'vision_snapshot_size', value: `${fromCapture('vision_snapshot_width') || 0}x${fromCapture('vision_snapshot_height') || 0}` },
    { label: 'vision_snapshot_byte_size', value: String(fromCapture('vision_snapshot_byte_size') || 0) },
    {
      label: 'screen_awareness_sample_count',
      value: String(fromCapture('screen_awareness_sample_count') || 0),
    },
    {
      label: 'screen_awareness_model_detail',
      value: fromCapture('screen_awareness_model_detail') || '',
    },
    {
      label: 'screen_awareness_model_last_stage',
      value: fromCapture('screen_awareness_model_last_stage') || '',
    },
    {
      label: 'screen_awareness_model_last_confidence',
      value: formatFixedNumber(fromCapture('screen_awareness_model_last_confidence'), 2),
    },
    { label: 'consecutive_same_capture_frames', value: String(fromCapture('consecutive_same_frames', 'consecutive_same_capture_frames') || 0) },
    { label: 'stale_capture_backend', value: String(Boolean(fromCapture('stale_backend', 'stale_capture_backend'))) },
    { label: 'last_raw_ocr_text', value: fromOcr('last_raw_text', 'last_raw_ocr_text') || '' },
    { label: 'last_rejected_ocr_text', value: fromOcr('last_rejected_text', 'last_rejected_ocr_text') || '' },
    { label: 'last_rejected_ocr_reason', value: fromOcr('last_rejected_reason', 'last_rejected_ocr_reason') || '' },
    { label: 'last_rejected_ocr_at', value: fromOcr('last_rejected_at', 'last_rejected_ocr_at') || '' },
    { label: 'last_rejected_capture_backend', value: fromOcr('last_rejected_capture_backend') || '' },
    { label: 'screen_awareness_last_skip_reason', value: fromCapture('screen_awareness_last_skip_reason') || '' },
    {
      label: 'screen_awareness_last_region_count',
      value: String(fromCapture('screen_awareness_last_region_count') || 0),
    },
    {
      label: 'screen_awareness_last_capture_duration_seconds',
      value: formatOcrRuntimeSeconds(fromCapture('screen_awareness_last_capture_duration_seconds')),
    },
    {
      label: 'screen_awareness_last_ocr_duration_seconds',
      value: formatOcrRuntimeSeconds(fromCapture('screen_awareness_last_ocr_duration_seconds')),
    },
    { label: 'last_observed_line', value: fromOcr('last_observed_line')?.text || '' },
    { label: 'last_stable_line', value: fromOcr('last_stable_line')?.text || '' },
    { label: 'ocr_capture_diagnostic_required', value: String(Boolean(fromCapture('diagnostic_required', 'ocr_capture_diagnostic_required'))) },
    { label: 'backend_kind', value: fromOcr('backend_kind') || '' },
    { label: 'backend_detail', value: fromOcr('backend_detail') || '' },
    { label: 'backend_path', value: fromOcr('backend_path') || '' },
    { label: 'backend_model', value: fromOcr('backend_model') || '' },
    { label: 'languages', value: fromOcr('languages') || '' },
    { label: 'takeover_reason', value: runtime.takeover_reason || '' },
    { label: 'target_selection_mode', value: fromWindow('selection_mode', 'target_selection_mode') || '' },
    { label: 'target_selection_detail', value: fromWindow('selection_detail', 'target_selection_detail') || '' },
    { label: 'effective_window_key', value: fromWindow('effective_window_key') || '' },
    { label: 'effective_window_title', value: fromWindow('effective_window_title') || '' },
    { label: 'effective_process_name', value: fromWindow('effective_process_name') || '' },
    { label: 'target_is_foreground', value: String(Boolean(fromWindow('target_is_foreground'))) },
    { label: 'foreground_refresh_at', value: fromWindow('foreground_refresh_at') || '' },
    { label: 'foreground_refresh_detail', value: fromWindow('foreground_refresh_detail') || '' },
    { label: 'foreground_hwnd', value: String(fromWindow('foreground_hwnd') || 0) },
    { label: 'target_hwnd', value: String(fromWindow('target_hwnd') || 0) },
    { label: 'foreground_advance_monitor_running', value: String(Boolean(fromAdvance('foreground_monitor_running', 'foreground_advance_monitor_running'))) },
    { label: 'foreground_advance_last_seq', value: String(fromAdvance('foreground_last_seq', 'foreground_advance_last_seq') || 0) },
    { label: 'foreground_advance_consumed_seq', value: String(fromAdvance('foreground_consumed_seq', 'foreground_advance_consumed_seq') || 0) },
    { label: 'foreground_advance_last_kind', value: fromAdvance('foreground_last_kind', 'foreground_advance_last_kind') || '' },
    { label: 'foreground_advance_last_delta', value: String(fromAdvance('foreground_last_delta', 'foreground_advance_last_delta') || 0) },
    { label: 'foreground_advance_last_matched', value: String(Boolean(fromAdvance('foreground_last_matched', 'foreground_advance_last_matched'))) },
    { label: 'foreground_advance_last_match_reason', value: fromAdvance('foreground_last_match_reason', 'foreground_advance_last_match_reason') || '' },
    { label: 'last_poll_started_at', value: fromTiming('last_poll_started_at') || '' },
    { label: 'last_poll_completed_at', value: fromTiming('last_poll_completed_at') || '' },
    {
      label: 'last_poll_duration_seconds',
      value: formatOcrRuntimeSeconds(fromTiming('last_poll_duration_seconds')),
    },
    {
      label: 'last_capture_total_duration_seconds',
      value: formatOcrRuntimeSeconds(fromTiming('last_capture_total_duration_seconds')),
    },
    {
      label: 'last_capture_frame_duration_seconds',
      value: formatOcrRuntimeSeconds(fromTiming('last_capture_frame_duration_seconds')),
    },
    {
      label: 'last_capture_background_duration_seconds',
      value: formatOcrRuntimeSeconds(fromTiming('last_capture_background_duration_seconds')),
    },
    {
      label: 'last_capture_image_hash_duration_seconds',
      value: formatOcrRuntimeSeconds(fromTiming('last_capture_image_hash_duration_seconds')),
    },
    {
      label: 'last_ocr_extract_duration_seconds',
      value: formatOcrRuntimeSeconds(fromTiming('last_ocr_extract_duration_seconds')),
    },
    {
      label: 'last_backend_plan_duration_seconds',
      value: formatOcrRuntimeSeconds(fromTiming('last_backend_plan_duration_seconds')),
    },
    {
      label: 'last_window_scan_duration_seconds',
      value: formatOcrRuntimeSeconds(fromTiming('last_window_scan_duration_seconds')),
    },
    { label: 'last_capture_background_hash_skipped', value: String(Boolean(fromAdvance('last_background_hash_skipped', 'last_capture_background_hash_skipped'))) },
    { label: 'last_poll_emitted_event', value: String(Boolean(fromAdvance('last_poll_emitted_event'))) },
    { label: 'last_tick_skipped', value: String(Boolean(fromAdvance('last_tick_skipped'))) },
    { label: 'last_tick_skip_reason', value: fromAdvance('last_tick_skip_reason') || '' },
    { label: 'pending_visual_scene_count', value: String(fromAdvance('pending_visual_scene_count') || 0) },
    { label: 'last_auto_recalibrate_attempts', value: String(fromAdvance('last_auto_recalibrate_attempts') || 0) },
    {
      label: 'last_auto_recalibrate_duration_seconds',
      value: formatOcrRuntimeSeconds(fromAdvance('last_auto_recalibrate_duration_seconds')),
    },
    { label: 'last_auto_recalibrate_limited', value: String(Boolean(fromAdvance('last_auto_recalibrate_limited'))) },
    { label: 'last_auto_recalibrate_error', value: fromAdvance('last_auto_recalibrate_error') || '' },
    { label: 'candidate_count', value: String(fromWindow('candidate_count') || 0) },
    { label: 'excluded_candidate_count', value: String(fromWindow('excluded_candidate_count') || 0) },
    { label: 'last_exclude_reason', value: fromWindow('last_exclude_reason') || '' },
  ]);
}

function renderSnapshotGridFromLatestData() {
  const snapshot = latestSnapshotData || {};
  const state = snapshot.snapshot || {};
  renderGrid('snapshotGrid', [
    { label: 'game_id', value: snapshot.game_id || '' },
    { label: 'session_id', value: snapshot.session_id || '' },
    { label: 'speaker', value: state.speaker || '' },
    { label: 'text', value: state.text || '' },
    { label: 'stability', value: state.stability || '' },
    { label: 'scene_id', value: state.scene_id || '' },
    { label: 'line_id', value: state.line_id || '' },
    { label: 'route_id', value: state.route_id || '' },
    { label: 'is_menu_open', value: String(Boolean(state.is_menu_open)) },
    { label: 'snapshot_ts', value: snapshot.snapshot_ts || '' },
    { label: 'stale', value: String(Boolean(snapshot.stale)) },
  ]);
}

function formatMemoryReaderSelectionDetail(detail) {
  const mapping = {
    auto_candidate_scan: uiT('ui.memory.detail.auto_candidate_scan', 'Автообнаружение игрового процесса'),
    manual_target_active: uiT('ui.memory.detail.manual_target_active', 'Ручная блокировка включена'),
    manual_target_exact: uiT('ui.memory.detail.manual_target_exact', 'Совпадение с вручную заблокированным процессом'),
    manual_target_rebound: uiT('ui.memory.detail.manual_target_rebound', 'Повторная привязка по exe-пути и имени процесса'),
    manual_target_unavailable: uiT('ui.memory.detail.manual_target_unavailable', 'Ручной процесс недоступен; выберите снова'),
    manual_pid_unimplemented: uiT('ui.memory.detail.manual_pid_unimplemented', 'auto_detect=false, но ручная цель еще не заблокирована'),
    no_detected_game_process: uiT('ui.memory.detail.no_detected_game_process', 'Доступный игровой процесс не обнаружен'),
    detected_kirikiri_xp3: uiT('ui.memory.detail.detected_kirikiri_xp3', 'KiriKiri обнаружен по ресурсам xp3'),
    detected_kirikiri_common_xp3: uiT('ui.memory.detail.detected_kirikiri_common_xp3', 'KiriKiri обнаружен по распространенным ресурсам xp3'),
    detected_kirikiri_startup_tjs: uiT('ui.memory.detail.detected_kirikiri_startup_tjs', 'KiriKiri обнаружен по startup.tjs'),
    detected_kirikiri_module: uiT('ui.memory.detail.detected_kirikiri_module', 'KiriKiri обнаружен по krkr.dll'),
    detected_kirikiri_process_name: uiT('ui.memory.detail.detected_kirikiri_process_name', 'KiriKiri обнаружен по имени процесса'),
    detected_kirikiri_preset_senren_banka: uiT('ui.memory.detail.detected_kirikiri_preset_senren_banka', 'KiriKiri обнаружен по встроенной сигнатуре Senren Banka'),
    detected_unity_module: uiT('ui.memory.detail.detected_unity_module', 'Unity обнаружен по загруженным модулям'),
    detected_unity_name_or_cmdline: uiT('ui.memory.detail.detected_unity_name_or_cmdline', 'Unity обнаружен по информации процесса'),
    detected_renpy_module: uiT('ui.memory.detail.detected_renpy_module', 'RenPy обнаружен по загруженным модулям'),
    detected_renpy_cmdline: uiT('ui.memory.detail.detected_renpy_cmdline', 'RenPy обнаружен по командной строке'),
    unknown_engine: uiT('ui.memory.detail.unknown_engine', 'Неизвестный движок'),
  };
  return uiDynamicT('ui.memory.detail', detail, mapping[detail] || detail || '');
}

function renderMemoryReaderTargetStatus(status) {
  const runtime = status.memory_reader_runtime || {};
  const snapshot = latestMemoryProcessSnapshot || {};
  const target = status.memory_reader_target || snapshot.manual_target || {};
  const modeText = document.getElementById('memoryReaderTargetModeText');
  const hint = document.getElementById('memoryReaderRuntimeHint');
  const autoButton = document.getElementById('memoryProcessAutoBtn');
  const mode = runtime.target_selection_mode || target.mode || snapshot.target_selection_mode || 'auto';
  const processName = runtime.process_name || target.process_name || '';
  const pid = runtime.pid || target.pid || '';
  const engine = runtime.engine || target.engine || target.detected_engine || '';
  const detail = formatMemoryReaderSelectionDetail(runtime.target_selection_detail || runtime.detection_reason || '');
  if (modeText) {
    modeText.textContent = mode === 'manual'
      ? `${uiT('ui.window.current_mode', 'Текущий режим')}: manual${target.process_name ? ` | ${uiT('ui.window.locked', 'Заблокировано')} ${target.process_name}` : ''}`
      : `${uiT('ui.window.current_mode', 'Текущий режим')}: ${uiT('ui.window.auto_detect_first', 'Сначала автоопределение')}`;
  }
  if (hint) {
    const parts = [
      processName ? `${uiT('ui.window.current_target', 'Текущая цель')}: ${processName}${pid ? ` (${pid})` : ''}` : '',
      engine ? `engine=${engine}` : '',
      detail,
      runtime.hook_code_detail ? `hook=${runtime.hook_code_detail} (${runtime.hook_code_count || 0})` : '',
    ].filter(Boolean);
    hint.textContent = parts.join(' | ') || uiT('ui.memory.auto_hint', 'Memory Reader сначала определяет RenPy / Unity / KiriKiri. Если автоопределение не сработало, выберите процесс вручную.');
  }
  if (autoButton) {
    autoButton.disabled = mode !== 'manual';
  }
  renderLockedMemoryProcess(status);
}

function renderLockedMemoryProcess(status) {
  const runtime = (status || {}).memory_reader_runtime || {};
  const snapshot = latestMemoryProcessSnapshot || {};
  const target = (status || {}).memory_reader_target || snapshot.manual_target || {};
  const card = document.getElementById('memoryLockedProcessCard');
  if (!card) {
    return;
  }
  const mode = runtime.target_selection_mode || target.mode || snapshot.target_selection_mode || 'auto';
  const processName = target.process_name || runtime.process_name || '';
  const pid = target.pid || runtime.pid || '';
  const exePath = target.exe_path || runtime.exe_path || '';
  const engine = target.engine || target.detected_engine || runtime.engine || '';
  const detail = formatMemoryReaderSelectionDetail(runtime.target_selection_detail || target.detection_reason || runtime.detection_reason || '');
  if (mode === 'manual' && (processName || exePath || pid)) {
    card.innerHTML = `
      <div class="locked-window-info">
        <p class="list-kicker">${escapeHtml(processName || uiT('ui.window.unknown_process', 'Неизвестный процесс'))}${pid ? ` · PID ${escapeHtml(pid)}` : ''}</p>
        <h3>${escapeHtml(engine || 'unknown')}</h3>
        <p class="result-note mono">${escapeHtml(exePath || target.process_key || '')}</p>
        <div class="window-candidate-meta">
          <span class="status-chip active">${escapeHtml(uiT('ui.window.manual_locked', 'Ручная блокировка'))}</span>
          ${detail ? `<span class="status-chip">${escapeHtml(detail)}</span>` : ''}
        </div>
      </div>
    `;
  } else if (runtime.process_name) {
    card.innerHTML = `
      <div class="locked-window-info">
        <p class="list-kicker">${escapeHtml(runtime.process_name)}${runtime.pid ? ` · PID ${escapeHtml(runtime.pid)}` : ''}</p>
        <h3>${escapeHtml(runtime.engine || 'unknown')}</h3>
        <p class="result-note">${escapeHtml(detail || uiT('ui.memory.auto_detected_target', 'Цель Memory Reader обнаружена автоматически'))}</p>
        <div class="window-candidate-meta">
          <span class="status-chip active">${escapeHtml(uiT('ui.window.auto_detected', 'Автоопределено'))}</span>
        </div>
      </div>
    `;
  } else {
    card.innerHTML = `<div class="locked-window-empty">${escapeHtml(uiT('ui.memory.no_locked_target', 'Целевой процесс Memory Reader еще не подтвержден. Если автоопределение не удалось, нажмите «Выбрать процесс» для ручной блокировки.'))}</div>`;
  }
}

function renderMemoryProcessListToNode(node, processes) {
  renderPreservingScroll(node, () => {
    if (!processes.length) {
      node.className = 'stack-list scroll-region empty-state window-candidate-list';
      node.textContent = uiT('ui.modal.no_process', 'Нет процессов-кандидатов');
    } else {
      node.className = 'stack-list scroll-region window-candidate-list';
      node.innerHTML = processes.map((item) => {
        const chips = [
          item.is_attached ? `<span class="status-chip active">${escapeHtml(uiT('ui.window.attached', 'Сейчас подключено'))}</span>` : '',
          item.is_manual_target ? `<span class="status-chip active">${escapeHtml(uiT('ui.window.manual_locked', 'Ручная блокировка'))}</span>` : '',
          item.engine || item.detected_engine ? `<span class="status-chip">${escapeHtml(item.engine || item.detected_engine)}</span>` : '',
        ].filter(Boolean).join('');
        return `
          <article class="list-card compact">
            <div class="window-candidate-header">
              <div class="window-candidate-summary">
                <p class="list-kicker">${escapeHtml(item.process_name || uiT('ui.window.unknown_process', 'Неизвестный процесс'))} · pid ${escapeHtml(item.pid || 0)}</p>
                <h3>${escapeHtml(formatMemoryReaderSelectionDetail(item.detection_reason || '') || item.detection_reason || 'unknown_engine')}</h3>
              </div>
              <button class="secondary" data-memory-process-key="${escapeHtml(item.process_key || '')}">${escapeHtml(uiT('ui.window.lock_process', 'Заблокировать процесс'))}</button>
            </div>
            <p class="result-note mono">${escapeHtml(item.exe_path || item.process_key || '')}</p>
            <div class="window-candidate-actions">
              <div class="window-candidate-meta">${chips}</div>
            </div>
          </article>
        `;
      }).join('');
    }
  });
  node.querySelectorAll('[data-memory-process-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.getAttribute('data-memory-process-key') || '';
      withButtonPending(button, uiT('ui.pending.locking', 'Блокировка...'), () => setMemoryProcessTarget(key)).catch((error) => { console.error('[galgame] async action failed', error); });
    });
  });
}

function renderMemoryProcessTargetSnapshot(snapshot, status = latestStatus) {
  latestMemoryProcessSnapshot = snapshot;
  const modal = document.getElementById('memoryProcessModal');
  if (modal && !modal.hidden) {
    const modalList = document.getElementById('memoryProcessList');
    renderMemoryProcessListToNode(modalList, snapshot.processes || []);
  }
  renderMemoryReaderTargetStatus(status || { memory_reader_runtime: {} });
}

function formatOcrWindowReason(reason) {
  const mapping = {
    excluded_self_window: uiT('ui.ocr.window.reason.excluded_self_window', 'Исключено само окно N.E.K.O'),
    excluded_overlay_window: uiT('ui.ocr.window.reason.excluded_overlay_window', 'Исключено окно overlay / launcher / helper'),
    excluded_helper_window: uiT('ui.ocr.window.reason.excluded_helper_window', 'Исключено системное или вспомогательное окно хоста'),
    excluded_small_or_hidden_window: uiT('ui.ocr.window.reason.excluded_small_or_hidden_window', 'Исключено слишком маленькое или недоступное окно'),
    excluded_minimized_window: uiT('ui.ocr.window.reason.excluded_minimized_window', 'Окно игры свернуто; OCR не может его захватить. Восстановите окно.'),
    excluded_non_game_process: uiT('ui.ocr.window.reason.excluded_non_game_process', 'Неигровой процесс проигнорирован'),
  };
  return uiDynamicT('ui.ocr.window.reason', reason, mapping[reason] || reason || 'unknown');
}

function formatOcrWindowSelectionDetail(detail) {
  const mapping = {
    auto_candidate_scan: uiT('ui.ocr.window.detail.auto_candidate_scan', 'Автообнаружение окна игры'),
    manual_target_active: uiT('ui.ocr.window.detail.manual_target_active', 'Ручная блокировка включена'),
    manual_target_exact: uiT('ui.ocr.window.detail.manual_target_exact', 'Совпадение с вручную заблокированным окном'),
    manual_target_rebound: uiT('ui.ocr.window.detail.manual_target_rebound', 'Ручное окно повторно привязано по сигнатуре'),
    manual_target_unavailable_fallback_to_auto: uiT('ui.ocr.window.detail.manual_target_unavailable_fallback_to_auto', 'Ручное окно недоступно; заблокируйте окно снова'),
    waiting_for_manual_window_target: uiT('ui.ocr.window.detail.waiting_for_manual_window_target', 'Автообнаружение не удалось; вручную заблокируйте целевое OCR-окно'),
    auto_detect_needs_manual_fallback: uiT('ui.ocr.window.detail.auto_detect_needs_manual_fallback', 'Надежная автоцель не найдена; выберите окно игры вручную'),
    foreground_window_needs_manual_confirmation: uiT('ui.ocr.window.detail.foreground_window_needs_manual_confirmation', 'Текущее окно переднего плана не похоже на игру; выберите окно игры вручную'),
    no_eligible_window: uiT('ui.ocr.window.detail.no_eligible_window', 'Сейчас нет доступного окна игры'),
    memory_reader_window_minimized: uiT('ui.ocr.window.detail.memory_reader_window_minimized', 'Окно игры свернуто; OCR не может его захватить. Восстановите окно.'),
    memory_reader_minimized_overridden_by_foreground: uiT('ui.ocr.window.detail.memory_reader_minimized_overridden_by_foreground', 'Окно было помечено как свернутое, но фактически на переднем плане, поэтому восстановлено автоматически'),
    memory_reader_pid: uiT('ui.ocr.window.detail.memory_reader_pid', 'Сначала повторно используется PID, найденный Memory Reader'),
    memory_reader_process: uiT('ui.ocr.window.detail.memory_reader_process', 'Сначала повторно используется процесс, найденный Memory Reader'),
    manual_target_overridden_by_memory_reader: uiT('ui.ocr.window.detail.manual_target_overridden_by_memory_reader', 'Цель Memory Reader отличается от ручной цели OCR, поэтому предпочтение отдано Memory Reader'),
    manual_target_overridden_by_memory_reader_pid: uiT('ui.ocr.window.detail.manual_target_overridden_by_memory_reader_pid', 'Ручная цель OCR устарела; переключено обратно на текущую игру по PID Memory Reader'),
    manual_target_overridden_by_memory_reader_process: uiT('ui.ocr.window.detail.manual_target_overridden_by_memory_reader_process', 'Ручная цель OCR устарела; переключено обратно на текущую игру по процессу Memory Reader'),
    manual_target_overridden_by_memory_reader_unavailable: uiT('ui.ocr.window.detail.manual_target_overridden_by_memory_reader_unavailable', 'Memory Reader переключился на другую игру, поэтому OCR не будет продолжать читать старое окно'),
    memory_reader_target_unavailable: uiT('ui.ocr.window.detail.memory_reader_target_unavailable', 'Целевое окно Memory Reader недоступно; OCR приостановлен, чтобы не читать неправильное окно'),
    attached_hwnd: uiT('ui.ocr.window.detail.attached_hwnd', 'Предпочесть текущее подключенное окно'),
    attached_pid: uiT('ui.ocr.window.detail.attached_pid', 'Предпочесть текущий подключенный процесс'),
    foreground_window: uiT('ui.ocr.window.detail.foreground_window', 'Предпочесть текущее окно-кандидат на переднем плане'),
    scored_candidate: uiT('ui.ocr.window.detail.scored_candidate', 'Выбрано по рейтингу кандидатов'),
  };
  return uiDynamicT('ui.ocr.window.detail', detail, mapping[detail] || detail || '');
}

function renderOcrWindowTargetStatus(status) {
  const runtime = status.ocr_reader_runtime || {};
  const snapshot = latestOcrWindowSnapshot || {};
  const modeText = document.getElementById('ocrWindowTargetModeText');
  const hint = document.getElementById('ocrWindowRuntimeHint');
  const autoButton = document.getElementById('ocrWindowAutoBtn');
  const mode = runtime.target_selection_mode || snapshot.target_selection_mode || 'auto';
  const manualTarget = runtime.manual_target || snapshot.manual_target || {};
  const effectiveTitle = runtime.effective_window_title || runtime.window_title || '';
  const effectiveProcess = runtime.effective_process_name || runtime.process_name || '';
  const detail = formatOcrWindowSelectionDetail(runtime.target_selection_detail || '');
  let captureHint = '';
  if (runtime.capture_backend_kind === 'dxcam') {
    captureHint = uiT('ui.ocr.window.capture_dxcam', 'Используется бэкенд захвата DXcam');
  } else if (runtime.capture_backend_detail === 'dxcam_unavailable_fallback') {
    captureHint = uiT('ui.ocr.window.capture_dxcam_unavailable', 'DXcam не установлен, используется совместимый захват. Установка dxcam может снизить проблемы перекрытия и старых кадров.');
  } else if (runtime.capture_backend_detail === 'dxcam_failed_fallback') {
    captureHint = uiT('ui.ocr.window.capture_dxcam_failed', 'Захват DXcam не удался, выполнен автоматический переход на совместимый захват');
  } else if (runtime.capture_backend_kind) {
    captureHint = `${uiT('ui.ocr.window.capture_compat_prefix', 'Используется')} ${runtime.capture_backend_kind} ${uiT('ui.ocr.window.capture_compat_suffix', 'совместимый захват')}`;
  }
  if (runtime.stale_capture_backend) {
    captureHint = uiT('ui.ocr.window.capture_stale', 'Источник захвата не обновляется. Вернитесь к окну игры или переключите бэкенд DXcam.');
  }
  const hintParts = [
    effectiveProcess ? `${uiT('ui.window.current_target', 'Текущая цель')}: ${effectiveProcess}${runtime.pid ? ` (${runtime.pid})` : ''}` : '',
    effectiveTitle ? `${uiT('ui.window.window_label', 'Окно')}: ${effectiveTitle}` : '',
    captureHint,
    detail,
    runtime.last_exclude_reason ? `${uiT('ui.ocr.window.last_excluded', 'Последнее исключение')}: ${formatOcrWindowReason(runtime.last_exclude_reason)}` : '',
  ].filter(Boolean);

  modeText.textContent = mode === 'manual'
    ? `${uiT('ui.window.current_mode', 'Текущий режим')}: manual${manualTarget.process_name ? ` | ${uiT('ui.window.locked', 'Заблокировано')} ${manualTarget.process_name}` : ''}`
    : `${uiT('ui.window.current_mode', 'Текущий режим')}: ${uiT('ui.window.auto_detect_first', 'Сначала автоопределение')}`;
  hint.textContent = hintParts.join(' | ') || uiT('ui.ocr.window.auto_hint', 'Плагин сначала пробует текущее переднее или привязанное игровое окно. Если уверенно определить его нельзя, выберите окно игры вручную.');
  autoButton.disabled = mode !== 'manual';
}

function renderLockedWindow(status) {
  const runtime = (status || {}).ocr_reader_runtime || {};
  const snapshot = latestOcrWindowSnapshot || {};
  const card = document.getElementById('ocrLockedWindowCard');
  const mode = runtime.target_selection_mode || snapshot.target_selection_mode || 'auto';
  const manualTarget = runtime.manual_target || snapshot.manual_target || {};
  const effectiveTitle = runtime.effective_window_title || runtime.window_title || '';
  const effectiveProcess = runtime.effective_process_name || runtime.process_name || '';

  if (mode === 'manual' && (manualTarget.process_name || effectiveProcess)) {
    const processName = manualTarget.process_name || effectiveProcess;
    const title = manualTarget.title || effectiveTitle;
    const pid = manualTarget.pid || runtime.pid || '';
    const windowKey = manualTarget.window_key || '';
    card.innerHTML = `
      <div class="locked-window-info">
        <p class="list-kicker">${escapeHtml(processName)}${pid ? ` · PID ${escapeHtml(pid)}` : ''}</p>
        <h3>${escapeHtml(title || uiT('ui.window.untitled', 'Окно без названия'))}</h3>
        <p class="result-note mono">${escapeHtml(windowKey)}</p>
        <div class="window-candidate-meta">
          <span class="status-chip active">${escapeHtml(uiT('ui.window.manual_locked', 'Ручная блокировка'))}</span>
        </div>
      </div>
    `;
  } else if (effectiveProcess || effectiveTitle) {
    const detail = formatOcrWindowSelectionDetail(runtime.target_selection_detail || '');
    card.innerHTML = `
      <div class="locked-window-info">
        <p class="list-kicker">${escapeHtml(effectiveProcess || uiT('ui.window.auto_detect_target', 'Автоцель'))}${runtime.pid ? ` · PID ${escapeHtml(runtime.pid)}` : ''}</p>
        <h3>${escapeHtml(effectiveTitle || uiT('ui.window.untitled', 'Окно без названия'))}</h3>
        <p class="result-note">${escapeHtml(detail || uiT('ui.ocr.window.auto_detected_target', 'Надежное игровое окно обнаружено автоматически'))}</p>
        <div class="window-candidate-meta">
          <span class="status-chip active">${escapeHtml(uiT('ui.window.auto_detected', 'Автоопределено'))}</span>
          ${runtime.target_is_foreground ? `<span class="status-chip active">${escapeHtml(uiT('ui.window.foreground', 'Переднее окно'))}</span>` : `<span class="status-chip warning">${escapeHtml(uiT('ui.window.not_foreground', 'Не на переднем плане'))}</span>`}
        </div>
      </div>
    `;
  } else {
    card.innerHTML = `<div class="locked-window-empty">${escapeHtml(uiT('ui.ocr.window.no_locked_target', 'Целевое окно OCR еще не подтверждено. Плагин сначала пробует переднее/привязанное игровое окно; если текст не читается, нажмите «Выбрать окно OCR» для ручной блокировки.'))}</div>`;
  }
}

function renderOcrWindowListToNode(node, windows) {
  renderPreservingScroll(node, () => {
    if (!windows.length) {
      node.className = 'stack-list scroll-region empty-state window-candidate-list';
      node.textContent = uiT('ui.ocr.window.no_available_window', 'Нет доступных игровых окон');
    } else {
      node.className = 'stack-list scroll-region window-candidate-list';
      node.innerHTML = windows.map((item) => {
        const chips = [
          item.is_attached ? `<span class="status-chip active">${escapeHtml(uiT('ui.window.attached', 'Сейчас подключено'))}</span>` : '',
          item.is_foreground ? `<span class="status-chip">${escapeHtml(uiT('ui.window.foreground', 'Переднее окно'))}</span>` : '',
          item.is_manual_target ? `<span class="status-chip active">${escapeHtml(uiT('ui.window.manual_locked', 'Ручная блокировка'))}</span>` : '',
        ].filter(Boolean).join('');
        return `
          <article class="list-card compact">
            <div class="window-candidate-header">
              <div class="window-candidate-summary">
                <p class="list-kicker">${escapeHtml(item.process_name || uiT('ui.window.unknown_process', 'Неизвестный процесс'))} · pid ${escapeHtml(item.pid || 0)}</p>
                <h3>${escapeHtml(item.title || uiT('ui.window.untitled', 'Окно без названия'))}</h3>
              </div>
              <button class="secondary" data-window-key="${escapeHtml(item.window_key || '')}">${escapeHtml(uiT('ui.window.lock_window', 'Заблокировать окно'))}</button>
            </div>
            <p class="result-note mono">${escapeHtml(item.window_key || '')}</p>
            <div class="window-candidate-actions">
              <div class="window-candidate-meta">${chips}</div>
            </div>
          </article>
        `;
      }).join('');
    }
  });
  node.querySelectorAll('[data-window-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.getAttribute('data-window-key') || '';
      withButtonPending(button, uiT('ui.pending.locking', 'Блокировка...'), () => setOcrWindowTarget(key)).catch((error) => { console.error('[galgame] async action failed', error); });
    });
  });
}

function renderOcrWindowTargetSnapshot(snapshot, status = latestStatus) {
  latestOcrWindowSnapshot = snapshot;
  const runtime = (status || {}).ocr_reader_runtime || {};
  const excludedNode = document.getElementById('ocrExcludedWindowList');
  const windows = snapshot.windows || [];
  const excludedWindows = snapshot.excluded_windows || [];
  emptyOcrWindowFocusForceRefreshDone = windows.length === 0
    ? emptyOcrWindowFocusForceRefreshDone
    : false;

  const modal = document.getElementById('ocrWindowModal');
  if (modal && !modal.hidden) {
    const modalList = document.getElementById('ocrWindowList');
    renderOcrWindowListToNode(modalList, windows);
  }

  renderPreservingScroll(excludedNode, () => {
    if (!excludedWindows.length) {
      excludedNode.className = 'stack-list scroll-region empty-state window-candidate-list';
      excludedNode.textContent = uiT('ui.ocr.window.no_excluded', 'Исключенных окон нет');
    } else {
      excludedNode.className = 'stack-list scroll-region window-candidate-list';
      excludedNode.innerHTML = excludedWindows.map((item) => `
        <article class="list-card compact">
          <p class="list-kicker">${escapeHtml(item.process_name || uiT('ui.window.unknown_process', 'Неизвестный процесс'))} · ${escapeHtml(formatOcrWindowReason(item.exclude_reason || ''))}</p>
          <h3>${escapeHtml(item.title || uiT('ui.window.untitled', 'Окно без названия'))}</h3>
          <p class="result-note mono">${escapeHtml(item.window_key || '')}</p>
        </article>
      `).join('');
    }
  });

  renderOcrWindowTargetStatus(status || { ocr_reader_runtime: runtime });
  renderLockedWindow(status || { ocr_reader_runtime: runtime });
}

function installButtonHtml(kind, installable, installed) {
  const installState = getInstallState(kind).state;
  const config = getInstallConfig(kind);
  if (installState && !isInstallTaskTerminal(installState)) {
    return `<button id="${kind}InstallBtn" class="primary" disabled>${escapeHtml(config.runningText)}</button>`;
  }
  if (installState && installState.status === 'failed' && installable) {
    return `<button id="${kind}InstallBtn" class="primary">${escapeHtml(config.retryText)}</button>`;
  }
  if (installable && !installed) {
    return `<button id="${kind}InstallBtn" class="primary">${escapeHtml(config.actionText)}</button>`;
  }
  return '';
}

function renderRapidOcr(status) {
  const rapidocr = status.rapidocr || {};
  const runtime = status.ocr_reader_runtime || {};
  const card = document.getElementById('rapidocrCard');
  const chip = document.getElementById('rapidocrCardChip');
  const desc = document.getElementById('rapidocrCardDesc');
  const meta = document.getElementById('rapidocrCardMeta');
  const actions = document.getElementById('rapidocrCardActions');
  if (!card || !chip || !desc || !meta || !actions) {
    return;
  }

  const rapidocrModelsMissing = hasMissingRapidOcrModelFiles(rapidocr);
  const rapidocrUsable = isRapidOcrUsable(rapidocr);
  const selectedBackend = status.ocr_backend_selection || 'auto';
  const usingRapidOcr = runtime.backend_kind === 'rapidocr';
  const manualGuide = status.download_guide?.rapidocr_models || {};
  const rapidocrJapanV5Note = (
    rapidocr.ocr_version === 'PP-OCRv5' && rapidocr.lang_type === 'japan'
      ? uiT('ui.install.rapidocr.v5_japan_note', 'Для японского распознавания используются модели детекции/ориентации PP-OCRv5 и японская модель распознавания PP-OCRv4.')
      : ''
  );
  applyRapidOcrModelsGate(rapidocr);
  const lastTask = installRuntime.rapidocr_models.state;
  const modelState = lastTask;
  const canDownloadModels = rapidocrModelsMissing && Boolean(rapidocr.can_download_models);
  const config = getInstallConfig('rapidocr_models');
  const lastStatus = modelState && modelState.status;
  const waitingRefresh = Boolean(isRecentLocalCompletedInstallTask(modelState) && rapidocrModelsMissing);
  const modelBusy = getInstallState('rapidocr_models').inProgress || waitingRefresh;
  const buttons = [
    `<button id="rapidocrUseBtn" class="secondary" ${(!rapidocrUsable || selectedBackend === 'rapidocr') ? 'disabled' : ''}>${escapeHtml(selectedBackend === 'rapidocr' ? uiT('ui.install.rapidocr.using', 'Используется RapidOCR') : uiT('ui.install.rapidocr.use', 'Использовать RapidOCR'))}</button>`,
    `<button id="ocrBackendAutoBtn" class="ghost" ${selectedBackend === 'auto' ? 'disabled' : ''}>${escapeHtml(selectedBackend === 'auto' ? uiT('ui.install.ocr_auto.using', 'Автовыбор OCR') : uiT('ui.install.ocr_auto', 'OCR авто'))}</button>`,
  ];
  if (canDownloadModels) {
    const downloadText = getInstallState('rapidocr_models').inProgress
      ? config.runningText
      : waitingRefresh
        ? uiT('ui.install.task_done_refreshing', 'Задача выполнена — ожидание обновления статуса плагина.')
        : lastStatus === 'failed'
          ? config.retryText
          : config.actionText;
    buttons.push(`<button id="rapidocrModelsDownloadBtn" class="primary" ${modelBusy ? 'disabled' : ''}>${escapeHtml(downloadText)}</button>`);
  }

  let cardStatus = 'warning';
  let chipText = uiT('ui.install.status.not_found', 'Не найдено');
  let descText = '';
  let metaText = '';

  if (!rapidocr.install_supported) {
    cardStatus = 'neutral';
    chipText = uiT('ui.install.status.unsupported', 'Не поддерживается');
    descText = uiT('ui.install.rapidocr.unsupported_body', 'Основной бэкенд RapidOCR требует поддерживаемую локальную среду выполнения.');
  } else if (rapidocrModelsMissing) {
    cardStatus = 'warning';
    chipText = uiT('ui.install.status.models_missing', 'Нет моделей');
    const missing = Array.isArray(rapidocr.missing_model_files) ? rapidocr.missing_model_files : [];
    const totalMb = (Number(rapidocr.missing_model_total_size || 0) / (1024 * 1024)).toFixed(1);
    const langType = rapidocr.lang_type || '';
    const ocrVersion = rapidocr.ocr_version || '';
    const modelSource = rapidocr.model_download_source || uiT('ui.status.unknown', 'Неизвестно');
    const modelCacheDir = rapidocr.model_cache_dir || uiT('ui.status.unknown', 'Неизвестно');
    const manualRecoveryBody = uiTf(
      'ui.install.rapidocr.missing_models_manual_body', 'Текущий выбор lang_type={lang} + ocr_version={version} требует недостающие файлы моделей. Автоскачивание использует ModelScope; при необходимости скачайте вручную по {source}, поместите файлы в {dir}, затем нажмите "Обновить статус".',
      {
        lang: langType,
        version: ocrVersion,
        source: modelSource,
        dir: modelCacheDir,
      },
    );
    descText = uiTf(
      'ui.install.rapidocr.missing_models_title_compact', 'Выбранные языковые модели не загружены ({count} файлов, ~{size} МБ)',
      { count: missing.length, size: totalMb },
    );
    const downloadFailed = Boolean(modelState && modelState.status === 'failed');
    metaText = [
      rapidocr.model_cache_dir ? `${uiT('ui.install.model_dir', 'Каталог моделей')}: ${rapidocr.model_cache_dir}` : '',
      rapidocr.model_download_source ? `${uiT('ui.install.rapidocr.download_source', 'Источник скачивания')}: ${rapidocr.model_download_source}` : '',
      manualGuide.url ? `${uiT('ui.install.manual_download_url', 'Ручная загрузка')}: ${manualGuide.url}` : '',
      manualGuide.code ? `${uiT('ui.install.manual_download_code', 'Код для распаковки')}: ${manualGuide.code}` : '',
      manualGuide.target_dir ? `${uiT('ui.install.manual_target_dir', 'Каталог установки')}: ${manualGuide.target_dir}` : '',
      rapidocrJapanV5Note,
      !canDownloadModels ? manualRecoveryBody : '',
      downloadFailed ? `${uiT('ui.install.last_error', 'Последняя ошибка')}: ${modelState.error || modelState.message || ''}` : '',
    ].filter(Boolean).join('\n');
  } else if (rapidocrUsable) {
    cardStatus = 'ok';
    chipText = uiT('ui.install.status.ready', 'Готово');
    descText = usingRapidOcr
      ? uiT('ui.install.rapidocr.active_title', 'RapidOCR уже обслуживает текущий OCR Reader')
      : uiT('ui.install.rapidocr.ready_body', 'RapidOCR готов. Когда нет SDK и нет валидного текста из памяти, он будет работать как бэкенд OCR Reader.');
    metaText = [
      rapidocr.detected_path ? `${uiT('ui.install.detected_path', 'Обнаруженный путь')}: ${rapidocr.detected_path}` : '',
      rapidocr.model_cache_dir ? `${uiT('ui.install.model_dir', 'Каталог моделей')}: ${rapidocr.model_cache_dir}` : '',
      usingRapidOcr ? `${uiT('ui.install.model_label', 'Модель')}: ${runtime.backend_model || rapidocr.selected_model || ''}` : '',
      rapidocrJapanV5Note,
    ].filter(Boolean).join('\n');
  } else if (rapidocr.detail === 'broken_runtime') {
    cardStatus = 'error';
    chipText = uiT('ui.install.status.broken', 'Повреждено');
    descText = uiT('ui.install.rapidocr.broken_body', 'Не удалось импортировать bundled rapidocr. Пересоберите venv плагина (`uv sync --group galgame`) или переустановите packaged build.');
    metaText = rapidocr.detected_path ? `${uiT('ui.install.detected_path', 'Обнаруженный путь')}: ${rapidocr.detected_path}` : '';
  } else {
    cardStatus = 'warning';
    chipText = uiT('ui.install.status.not_found', 'Не найдено');
    descText = uiT('ui.install.rapidocr.bundled_hint', 'Рантайм RapidOCR предоставляется packaged-приложением или зависимостями исходников; языковые модели galgame-плагин скачивает по требованию из ModelScope. Если рантайма нет в packaged-сборке, переустановите её; при запуске из исходников выполните `uv sync --group galgame` и перезапустите.');
  }

  if (modelState && !isInstallTaskTerminal(modelState)) {
    cardStatus = 'neutral';
    chipText = uiT('ui.install.status.installing', 'Установка');
  } else if (modelState && modelState.status === 'failed') {
    cardStatus = 'error';
    chipText = uiT('ui.install.status.failed', 'Ошибка');
  }

  card.className = `install-card ${cardStatus}`;
  chip.textContent = chipText;
  desc.textContent = descText;
  meta.textContent = metaText;
  syncActionButtons(actions, buttons.join(''));
  renderInstallTaskState('rapidocr_models');
  applyRapidOcrModelsGate(rapidocr);
  renderRapidOcrVersionBar(rapidocr);
  renderRapidOcrLangBar(rapidocr);
  rebindCardButton('rapidocrUseBtn', () => setOcrBackendSelection({ backendSelection: 'rapidocr' }));
  rebindCardButton('ocrBackendAutoBtn', () => setOcrBackendSelection({ backendSelection: 'auto' }));
  rebindCardButton('rapidocrModelsDownloadBtn', () => startInstall('rapidocr_models', false, { navigate: false }));
  bindRapidOcrLangButtons();
}

function renderRapidOcrVersionBar(rapidocr) {
  const bar = document.getElementById('rapidocrVersionBar');
  if (!bar) {
    return;
  }
  const usable = isRapidOcrUsable(rapidocr) || hasMissingRapidOcrModelFiles(rapidocr);
  bar.hidden = !usable;
  if (!usable) {
    setRapidOcrVersionControlsDisabled(true);
    return;
  }

  const ocrVersion = rapidocr.ocr_version || 'PP-OCRv4';
  const idMap = { 'PP-OCRv4': 'V4', 'PP-OCRv5': 'V5' };
  Object.entries(idMap).forEach(([version, suffix]) => {
    const btn = document.getElementById('rapidocrVersion' + suffix + 'Btn');
    if (!btn) {
      return;
    }
    btn.classList.toggle('active', ocrVersion === version);
    btn.setAttribute('aria-checked', ocrVersion === version ? 'true' : 'false');
    btn.setAttribute('tabindex', ocrVersion === version ? '0' : '-1');
    btn.disabled = rapidOcrLangRequestPending;
  });
}

function renderRapidOcrLangBar(rapidocr) {
  const bar = document.getElementById('rapidocrLangBar');
  if (!bar) {
    return;
  }
  const usable = isRapidOcrUsable(rapidocr) || hasMissingRapidOcrModelFiles(rapidocr);
  bar.hidden = !usable;
  if (!usable) {
    setRapidOcrLangControlsDisabled(true);
    return;
  }

  const langType = rapidocr.lang_type || 'ch';
  const autoDetect = rapidocr.auto_detect_lang !== false;
  const idMap = { ch: 'Ch', japan: 'Japan', korean: 'Korean', en: 'En' };
  Object.entries(idMap).forEach(([lang, suffix]) => {
    const btn = document.getElementById('rapidocrLang' + suffix + 'Btn');
    if (!btn) {
      return;
    }
    btn.classList.toggle('active', langType === lang);
    btn.setAttribute('aria-checked', langType === lang ? 'true' : 'false');
    btn.setAttribute('tabindex', langType === lang ? '0' : '-1');
    btn.disabled = rapidOcrLangRequestPending || autoDetect;
  });

  const checkbox = document.getElementById('rapidocrAutoDetectCheck');
  if (checkbox) {
    checkbox.checked = autoDetect;
    checkbox.disabled = rapidOcrLangRequestPending;
  }
}

function setRapidOcrLangControlsDisabled(disabled) {
  setRapidOcrVersionControlsDisabled(disabled);
  ['Ch', 'Japan', 'Korean', 'En'].forEach((suffix) => {
    const btn = document.getElementById('rapidocrLang' + suffix + 'Btn');
    if (btn) {
      btn.disabled = Boolean(disabled);
    }
  });
  const checkbox = document.getElementById('rapidocrAutoDetectCheck');
  if (checkbox) {
    checkbox.disabled = Boolean(disabled);
  }
}

function setRapidOcrVersionControlsDisabled(disabled) {
  ['V4', 'V5'].forEach((suffix) => {
    const btn = document.getElementById('rapidocrVersion' + suffix + 'Btn');
    if (btn) {
      btn.disabled = Boolean(disabled);
    }
  });
}

function bindRapidOcrLangButtons() {
  const versionMap = { V4: 'PP-OCRv4', V5: 'PP-OCRv5' };
  Object.entries(versionMap).forEach(([suffix, version]) => {
    rebindCardButton('rapidocrVersion' + suffix + 'Btn', () => setRapidOcrLang({ ocr_version: version }));
  });

  const idMap = { Ch: 'ch', Japan: 'japan', Korean: 'korean', En: 'en' };
  Object.entries(idMap).forEach(([suffix, lang]) => {
    rebindCardButton('rapidocrLang' + suffix + 'Btn', () => setRapidOcrLang({ lang_type: lang }));
  });

  const group = document.querySelector('.rapidocr-lang-buttons');
  if (group && !group.__galgameRapidOcrKeysBound) {
    group.__galgameRapidOcrKeysBound = true;
    group.addEventListener('keydown', (event) => {
      const buttons = Array.from(group.querySelectorAll('.rapidocr-lang-btn'));
      const enabledButtons = buttons.filter((button) => !button.disabled);
      if (!enabledButtons.length) {
        return;
      }
      const currentIndex = Math.max(0, enabledButtons.indexOf(document.activeElement));
      let nextIndex = -1;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = (currentIndex - 1 + enabledButtons.length) % enabledButtons.length;
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = (currentIndex + 1) % enabledButtons.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = enabledButtons.length - 1;
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.click();
        }
        return;
      } else {
        return;
      }
      event.preventDefault();
      const nextButton = enabledButtons[nextIndex];
      buttons.forEach((button) => {
        const selected = button === nextButton;
        button.setAttribute('tabindex', selected ? '0' : '-1');
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
        button.classList.toggle('active', selected);
      });
      nextButton.focus();
      nextButton.click();
    });
  }

  const checkbox = document.getElementById('rapidocrAutoDetectCheck');
  if (checkbox && !checkbox.__galgameRapidOcrAutoBound) {
    checkbox.__galgameRapidOcrAutoBound = true;
    checkbox.addEventListener('change', () => {
      setRapidOcrLang({ auto_detect_lang: checkbox.checked });
    });
  }
}

function renderDxcam(status) {
  const dxcam = status.dxcam || {};
  const runtime = status.ocr_reader_runtime || {};
  const card = document.getElementById('dxcamCard');
  const title = document.getElementById('dxcamCardTitle');
  const chip = document.getElementById('dxcamCardChip');
  const desc = document.getElementById('dxcamCardDesc');
  const meta = document.getElementById('dxcamCardMeta');
  const actions = document.getElementById('dxcamCardActions');
  if (!card || !title || !chip || !desc || !meta || !actions) {
    return;
  }

  const installed = Boolean(dxcam.installed);
  const selectedCaptureBackend = textValue(status.ocr_capture_backend_selection || 'auto');
  const usingDxcam = runtime.capture_backend_kind === 'dxcam';
  const activeCaptureBackend = textValue(runtime.capture_backend_kind);
  const selectedBackendLabel = captureBackendLabel(selectedCaptureBackend);
  const activeBackendLabel = activeCaptureBackend
    ? captureBackendLabel(activeCaptureBackend)
    : uiT('ui.install.capture_backend.waiting_active', 'Ожидание следующего OCR-захвата для подтверждения');
  const detailText = textValue(runtime.capture_backend_detail || runtime.ocr_capture_backend_detail);
  const blockedText = textValue(status.ocr_capture_backend_block_reason || runtime.ocr_window_capture_block_reason);
  title.textContent = uiTf(
    'ui.install.capture_backend.card_title_with_backend', 'Бэкенд захвата: {backend}',
    { backend: activeCaptureBackend ? activeBackendLabel : selectedBackendLabel },
  );
  const captureActive = (value) => (
    value === 'mss'
      ? selectedCaptureBackend === 'mss' || selectedCaptureBackend === 'imagegrab'
      : selectedCaptureBackend === value
  );
  syncActionButtons(actions, [
    `<button id="smartCaptureUseBtn" class="secondary" ${captureActive('smart') ? 'disabled' : ''}>${escapeHtml(captureActive('smart') ? uiT('ui.install.smart.using', 'Используется Smart') : uiT('ui.install.smart.use', 'Использовать Smart'))}</button>`,
    `<button id="dxcamUseBtn" class="secondary" ${(!installed || captureActive('dxcam')) ? 'disabled' : ''}>${escapeHtml(captureActive('dxcam') ? uiT('ui.install.dxcam.using', 'Используется DXcam') : uiT('ui.install.dxcam.use', 'Использовать DXcam'))}</button>`,
    `<button id="captureBackendAutoBtn" class="ghost" ${captureActive('auto') ? 'disabled' : ''}>${escapeHtml(captureActive('auto') ? uiT('ui.install.capture_auto.using', 'Автовыбор захвата') : uiT('ui.install.capture_auto', 'Захват авто'))}</button>`,
    `<button id="mssUseBtn" class="ghost" ${captureActive('mss') ? 'disabled' : ''}>${escapeHtml(captureActive('mss') ? uiT('ui.install.mss.using', 'Используется MSS') : uiT('ui.install.mss.use', 'Использовать MSS'))}</button>`,
    `<button id="pyautoguiUseBtn" class="ghost" ${captureActive('pyautogui') ? 'disabled' : ''}>${escapeHtml(captureActive('pyautogui') ? uiT('ui.install.pyautogui.using', 'Используется PyAutoGUI') : uiT('ui.install.pyautogui.use', 'Использовать PyAutoGUI'))}</button>`,
    `<button id="printwindowUseBtn" class="ghost" ${captureActive('printwindow') ? 'disabled' : ''}>${escapeHtml(captureActive('printwindow') ? uiT('ui.install.printwindow.using', 'Используется PrintWindow') : uiT('ui.install.printwindow.use', 'Использовать PrintWindow'))}</button>`,
  ].join(''));

  if (!dxcam.install_supported) {
    card.className = 'install-card neutral';
    chip.textContent = activeCaptureBackend
      ? uiT('ui.install.status.ready', 'Готово')
      : uiT('ui.install.status.unsupported', 'Не поддерживается');
    desc.textContent = uiTf(
      'ui.install.capture_backend.desc', 'Выбрано: {selected}; активный бэкенд: {active}.',
      { selected: selectedBackendLabel, active: activeBackendLabel },
    );
    meta.textContent = uiT('ui.install.capture_backend.dxcam_unsupported_meta', 'DXcam недоступен на этой платформе; MSS, PyAutoGUI или PrintWindow можно использовать дальше.');
  } else if (installed) {
    card.className = `install-card ${usingDxcam ? 'ok' : 'neutral'}`;
    chip.textContent = uiT('ui.install.status.ready', 'Готово');
    desc.textContent = uiTf(
      'ui.install.capture_backend.desc', 'Выбрано: {selected}; активный бэкенд: {active}.',
      { selected: selectedBackendLabel, active: activeBackendLabel },
    );
    meta.textContent = detailText
      ? uiTf('ui.install.capture_backend.detail_meta', 'Детали бэкенда: {detail}', { detail: detailText })
      : uiT('ui.install.capture_backend.visible_window_meta', 'Для захвата окно игры должно быть видимым; ограничения фонового захвата ОС не обходятся.');
  } else {
    card.className = 'install-card warning';
    chip.textContent = activeCaptureBackend
      ? uiT('ui.install.status.ready', 'Готово')
      : uiT('ui.install.status.not_found', 'Не найдено');
    desc.textContent = uiTf(
      'ui.install.capture_backend.desc', 'Выбрано: {selected}; активный бэкенд: {active}.',
      { selected: selectedBackendLabel, active: activeBackendLabel },
    );
    meta.textContent = blockedText
      ? uiTf('ui.install.capture_backend.blocked_meta', 'Бэкенд заблокирован: {detail}', { detail: blockedText })
      : uiT('ui.install.capture_backend.dxcam_missing_meta', 'Если DXcam недоступен, MSS, PyAutoGUI или PrintWindow могут продолжить работу как бэкенд захвата.');
  }

  rebindCardButton('smartCaptureUseBtn', () => setOcrBackendSelection({ captureBackend: 'smart' }));
  rebindCardButton('dxcamUseBtn', () => setOcrBackendSelection({ captureBackend: 'dxcam' }));
  rebindCardButton('captureBackendAutoBtn', () => setOcrBackendSelection({ captureBackend: 'auto' }));
  rebindCardButton('mssUseBtn', () => setOcrBackendSelection({ captureBackend: 'mss' }));
  rebindCardButton('pyautoguiUseBtn', () => setOcrBackendSelection({ captureBackend: 'pyautogui' }));
  rebindCardButton('printwindowUseBtn', () => setOcrBackendSelection({ captureBackend: 'printwindow' }));
}

function renderTextractor(status) {
  const textractor = status.textractor || {};
  const runtime = status.memory_reader_runtime || {};
  const manualGuide = status.download_guide?.textractor || {};
  const card = document.getElementById('textractorCard');
  const chip = document.getElementById('textractorCardChip');
  const desc = document.getElementById('textractorCardDesc');
  const meta = document.getElementById('textractorCardMeta');
  const actions = document.getElementById('textractorCardActions');
  if (!card || !chip || !desc || !meta || !actions) {
    return;
  }

  const installState = getInstallState('textractor').state;
  const installable = Boolean(textractor.install_supported) && Boolean(textractor.can_install);
  const installed = Boolean(textractor.installed);
  const runtimeBlocked = runtime.detail === 'invalid_textractor_path';
  let cardStatus = 'warning';
  let chipText = uiT('ui.install.status.not_installed', 'Не установлено');
  let descText = '';
  let metaText = '';

  if (!textractor.install_supported) {
    cardStatus = 'neutral';
    chipText = uiT('ui.install.status.unsupported', 'Не поддерживается');
    descText = uiT('ui.install.textractor.unsupported_body', 'Резерв чтения памяти Textractor включается только в Windows, и теперь его приоритет ниже OCR Reader.');
  } else if (installed) {
    cardStatus = 'ok';
    chipText = uiT('ui.install.status.installed', 'Установлено');
    descText = runtimeBlocked
      ? uiT('ui.install.textractor.ready_blocked_title', 'Textractor установлен и ожидает ручного/экспериментального перехвата Memory Reader')
      : uiT('ui.install.textractor.ready_title', 'Textractor готов, но только как экспериментальный резерв');
    metaText = textractor.detected_path ? `${uiT('ui.install.detected_path', 'Обнаруженный путь')}: ${textractor.detected_path}` : '';
  } else {
    descText = uiT('ui.install.textractor.missing_body', 'Textractor влияет только на экспериментальный путь Memory Reader и не влияет на официальный порядок выполнения Bridge SDK > OCR Reader.');
    metaText = [
      textractor.expected_executable_path ? `${uiT('ui.install.expected_path', 'Ожидаемый путь установки')}: ${textractor.expected_executable_path}` : '',
      manualGuide.url ? `${uiT('ui.install.manual_download_url', 'Ручная загрузка')}: ${manualGuide.url}` : '',
      manualGuide.code ? `${uiT('ui.install.manual_download_code', 'Код для распаковки')}: ${manualGuide.code}` : '',
      manualGuide.target_dir ? `${uiT('ui.install.manual_target_dir', 'Каталог установки')}: ${manualGuide.target_dir}` : '',
    ].filter(Boolean).join('\n');
  }

  if (installState && !isInstallTaskTerminal(installState)) {
    cardStatus = 'neutral';
    chipText = uiT('ui.install.status.installing', 'Установка');
    descText = uiT('ui.install.textractor.installing_body', 'Загрузка идет по HTTPS, а эта страница получает ход выполнения через SSE. После завершения Textractor только усиливает экспериментальный путь Memory Reader.');
  } else if (installState && installState.status === 'failed') {
    cardStatus = 'error';
    chipText = uiT('ui.install.status.failed', 'Ошибка');
    const errorText = installState.error || installState.message || uiT('ui.install.task_failed_retry', 'Фоновая установка не удалась. Можно нажать кнопку еще раз и повторить.');
    const failedPhase = installState.failed_phase || '';
    let phaseHint = '';
    if (failedPhase === 'fetch_release') {
      phaseHint = uiT('ui.install.textractor.failed_fetch_release_hint', 'Не удается подключиться к GitHub. Проверьте сеть/доступность GitHub или настройте textractor_proxy в [memory_reader] файла plugin.toml. Обычно это не означает, что установщик плагина поврежден.');
    } else if (failedPhase === 'downloading') {
      phaseHint = uiT('ui.install.textractor.failed_downloading_hint', 'Загрузка Textractor была прервана, HTTP-запрос завершился ошибкой или проверка файла не прошла. Проверьте стабильность сети и повторите попытку.');
    } else if (failedPhase === 'extracting') {
      phaseHint = uiT('ui.install.textractor.failed_extracting_hint', 'Не удалось распаковать архив Textractor или проверить установку. Рекомендуется установить вручную по пути ниже.');
    }
    const expectedPath = textractor.expected_executable_path || 'TextractorCLI.exe';
    const manualGuide = uiTf(
      'ui.install.textractor.manual_install_guide', 'Ручная установка: скачайте последний zip с https://github.com/Artikash/Textractor/releases, распакуйте его, убедитесь, что TextractorCLI.exe находится в {path}, затем обновите статус.',
      { path: expectedPath },
    );
    descText = [errorText, phaseHint, manualGuide].filter(Boolean).join('\n');
  } else if (installState && installState.status === 'completed' && !installed) {
    cardStatus = 'neutral';
    chipText = uiT('ui.install.status.completed', 'Завершено');
    descText = installState.message || uiT('ui.install.task_done_refreshing', 'Задача выполнена — ожидание обновления статуса плагина.');
  }

  card.className = `install-card ${cardStatus}`;
  chip.textContent = chipText;
  desc.textContent = descText;
  meta.textContent = metaText;
  syncActionButtons(actions, installButtonHtml('textractor', installable, installed));
  if (installed) {
    const nodes = getInstallNodes('textractor');
    if (nodes.card) nodes.card.hidden = true;
  } else {
    renderInstallTaskState('textractor');
  }
  rebindCardButton('textractorInstallBtn', () => startInstall('textractor', false));
}

function renderOcrProfile(status) {
  const runtime = status.ocr_reader_runtime || {};
  const gamePresetSelect = document.getElementById('ocrProfileGamePresetSelect');
  const processInput = document.getElementById('ocrProfileProcessInput');
  const stageSelect = document.getElementById('ocrProfileStageSelect');
  const saveScopeSelect = document.getElementById('ocrProfileSaveScopeSelect');
  const leftInput = document.getElementById('ocrProfileLeftInput');
  const rightInput = document.getElementById('ocrProfileRightInput');
  const topInput = document.getElementById('ocrProfileTopInput');
  const bottomInput = document.getElementById('ocrProfileBottomInput');
  const hint = document.getElementById('ocrProfileRuntimeHint');
  const currentProcessName = processInput.value.trim() || runtime.process_name || '';
  const currentGamePresetId = gamePresetSelect?.value || 'auto';
  const currentStage = stageSelect.value || 'default';
  const defaultSaveScope = resolveRuntimeDefaultSaveScope(status, currentProcessName);
  if (!saveScopeSelect.value || (saveScopeSelect.value === 'window_bucket' && defaultSaveScope === 'process_fallback' && !runtime.width)) {
    saveScopeSelect.value = defaultSaveScope;
  }
  const currentSaveScope = normalizeCaptureProfileSaveScope(saveScopeSelect.value || defaultSaveScope);
  const profileValues = profileValueForInputs(
    resolveEditableCaptureProfile(
      status,
      currentProcessName,
      currentStage,
      currentSaveScope,
      currentGamePresetId,
    ),
  );
  const autoRecalibrateButton = document.getElementById('ocrProfileAutoRecalibrateBtn');
  const applyRecommendedButton = document.getElementById('ocrProfileApplyRecommendedBtn');
  const rollbackButton = document.getElementById('ocrProfileRollbackBtn');
  const autoApplyInput = document.getElementById('ocrProfileAutoApplyRecommendedInput');
  let autoRecalibrateReason = '';
  if (!Boolean(runtime.enabled)) {
    autoRecalibrateReason = uiT('ui.ocr_profile.auto_recalibrate.disabled_reader', 'OCR Reader отключен');
  } else if (runtime.detail === 'unsupported_platform') {
    autoRecalibrateReason = uiT('ui.ocr_profile.auto_recalibrate.unsupported_platform', 'Текущая платформа не Windows');
  } else if (runtime.detail === 'capture_backend_unavailable') {
    autoRecalibrateReason = uiT('ui.ocr_profile.auto_recalibrate.capture_backend_unavailable', 'Текущий бэкенд захвата недоступен');
  } else if (!runtime.process_name || !Number(runtime.width || 0) || !Number(runtime.height || 0)) {
    autoRecalibrateReason = uiT('ui.ocr_profile.auto_recalibrate.no_target_window', 'Нет прикрепленного целевого окна OCR');
  }
  const recommendedProfile = runtime.recommended_capture_profile
    || runtime.profile?.recommended_capture_profile
    || {};
  const recommendedStage = runtime.recommended_capture_profile_stage
    || runtime.profile?.recommended_capture_profile_stage
    || '';
  const recommendedReason = runtime.recommended_capture_profile_reason
    || runtime.profile?.recommended_capture_profile_reason
    || '';
  const recommendedConfidence = runtime.recommended_capture_profile_confidence
    || runtime.profile?.recommended_capture_profile_confidence
    || 0;
  const recommendedManualPresent = Boolean(
    runtime.recommended_capture_profile_manual_present
    || runtime.profile?.recommended_capture_profile_manual_present,
  );
  const recommendedHint = recommendedProfile && Object.keys(recommendedProfile).length
    ? uiTf(
      'ui.ocr_profile.recommended_hint', 'Рекомендуемая калибровка: {stage} {profile} ({reason}, confidence={confidence}, manual={manual})',
      {
        stage: ocrProfileStageLabel(recommendedStage, recommendedStage || uiT('ui.stage.dialogue', 'Область диалога')),
        profile: formatCaptureProfile(recommendedProfile),
        reason: recommendedReason || 'auto',
        confidence: formatFixedNumber(recommendedConfidence, 2),
        manual: recommendedManualPresent ? uiT('ui.common.yes_code', 'yes') : uiT('ui.common.no_code', 'no'),
      },
    )
    : '';
  const rollbackReason = runtime.capture_profile_last_rollback_reason || '';
  const pendingRollback = Boolean(runtime.capture_profile_pending_rollback);

  if (runtime.process_name) {
    hint.textContent = [
      uiTf('ui.ocr_profile.current_target', 'Текущая цель OCR: {process} ({pid})', {
        process: runtime.process_name,
        pid: runtime.pid || 0,
      }),
      runtime.window_title ? uiTf('ui.ocr_profile.window_title', 'Окно: {title}', { title: runtime.window_title }) : '',
      runtime.width && runtime.height ? uiTf('ui.ocr_profile.window_size', 'Размер: {width}x{height}', {
        width: runtime.width,
        height: runtime.height,
      }) : '',
      runtime.capture_stage
        ? uiTf('ui.ocr_profile.runtime_stage', 'Этап выполнения: {stage}', {
          stage: ocrProfileStageLabel(runtime.capture_stage, runtime.capture_stage),
        })
        : '',
      runtime.capture_profile_match_source
        ? uiTf('ui.ocr_profile.match_source', 'Источник совпадения: {source}', {
          source: ocrCaptureMatchSourceLabel(runtime.capture_profile_match_source, runtime.capture_profile_match_source),
        })
        : '',
      runtime.capture_profile_bucket_key ? uiTf('ui.ocr_profile.bucket', 'Бакет совпадения: {bucket}', { bucket: runtime.capture_profile_bucket_key }) : '',
      runtime.detail ? uiTf('ui.ocr_profile.status', 'Статус: {status}', { status: runtime.detail }) : '',
      runtime.takeover_reason ? uiTf('ui.ocr_profile.takeover_reason', 'Причина перехвата: {reason}', { reason: runtime.takeover_reason }) : '',
      recommendedHint,
      pendingRollback ? uiTf('ui.ocr_profile.rollback_observing', 'Наблюдение за откатом рекомендации: {count}/2', {
        count: runtime.capture_profile_rollback_failure_count || 0,
      }) : '',
      rollbackReason ? uiTf('ui.ocr_profile.rollback_status', 'Статус отката рекомендации: {reason}', { reason: rollbackReason }) : '',
      uiTf('ui.ocr_profile.auto_recalibrate_status', 'Автоперекалибровка: {status}', {
        status: autoRecalibrateReason || uiT('ui.ocr_profile.available', 'Доступно'),
      }),
      isAihongProcessName(currentProcessName || runtime.process_name)
        ? uiT('ui.ocr_profile.aihong_stage_hint', 'The Lamenting Geese поддерживает отдельное сохранение для диалогов и меню')
        : '',
    ].filter(Boolean).join(' | ');
  } else {
    hint.textContent = isAihongProcessName(currentProcessName)
      ? uiT('ui.ocr_profile.no_target_aihong_hint', 'Целевой процесс OCR еще не прикреплен. Можно вручную указать TheLamentingGeese.exe и заранее сохранить области диалогов и меню. Для автоперекалибровки сначала нужно прикрепить реальное окно игры.')
      : uiT('ui.ocr_profile.no_target_hint', 'Целевой процесс OCR еще не прикреплен. Можно вручную указать process_name и заранее сохранить калибровку снимка. Для автоперекалибровки сначала нужно прикрепить реальное окно игры.');
  }

  if (!processInput.value || document.activeElement !== processInput) {
    setInputValueIfIdle(processInput, runtime.process_name || processInput.value);
  }
  if (!saveScopeSelect.value) {
    saveScopeSelect.value = defaultSaveScope;
  }
  setInputValueIfIdle(leftInput, profileValues.left);
  setInputValueIfIdle(rightInput, profileValues.right);
  setInputValueIfIdle(topInput, profileValues.top);
  setInputValueIfIdle(bottomInput, profileValues.bottom);
  autoRecalibrateButton.disabled = Boolean(autoRecalibrateReason);
  autoRecalibrateButton.title = autoRecalibrateReason || uiT('ui.ocr_profile.auto_recalibrate.title', 'Автоматически перекалибровать область диалога по текущему прикрепленному окну');
  if (applyRecommendedButton) {
    const applyBlocked = !recommendedProfile
      || !Object.keys(recommendedProfile).length
      || recommendedManualPresent;
    applyRecommendedButton.disabled = applyBlocked;
    applyRecommendedButton.title = recommendedManualPresent
      ? uiT('ui.ocr_profile.apply_recommended.manual_present_title', 'Ручной profile уже существует, поэтому рекомендация не будет перезаписана автоматически. Можно сохранить калибровку вручную.')
      : (applyBlocked
        ? uiT('ui.ocr_profile.apply_recommended.blocked_title', 'Нет рекомендуемого profile для применения')
        : uiT('ui.ocr_profile.apply_recommended.title', 'Применить текущий рекомендуемый profile и сохранить точку автоотката'));
  }
  if (rollbackButton) {
    rollbackButton.disabled = !pendingRollback;
    rollbackButton.title = pendingRollback
      ? uiT('ui.ocr_profile.rollback.title', 'Откатить последнее применение рекомендуемого profile')
      : uiT('ui.ocr_profile.rollback.blocked_title', 'Нет рекомендуемого profile, ожидающего отката');
  }
  if (autoApplyInput && document.activeElement !== autoApplyInput) {
    autoApplyInput.checked = Boolean(runtime.capture_profile_auto_apply_enabled);
  }
}

function selectOcrGameCapturePreset() {
  const gamePresetSelect = document.getElementById('ocrProfileGamePresetSelect');
  const processInput = document.getElementById('ocrProfileProcessInput');
  const selectedGamePreset = OCR_GAME_CAPTURE_PRESETS[gamePresetSelect?.value || ''];
  if (selectedGamePreset) {
    const stageSelect = document.getElementById('ocrProfileStageSelect');
    const saveScopeSelect = document.getElementById('ocrProfileSaveScopeSelect');
    if (processInput) {
      processInput.value = selectedGamePreset.process_name;
    }
    if (stageSelect) {
      stageSelect.value = selectedGamePreset.default_stage;
    }
    if (
      saveScopeSelect
      && resolveRuntimeDefaultSaveScope(
        latestStatus || {},
        selectedGamePreset.process_name,
      ) === 'process_fallback'
    ) {
      saveScopeSelect.value = 'process_fallback';
    }
  }
  renderOcrProfile(latestStatus || { ocr_reader_runtime: {} });
  if (selectedGamePreset && processInput) {
    processInput.value = selectedGamePreset.process_name;
  }
}

function renderHistory(history) {
  const mergedLines = mergedHistoryLines(history);
  const runtime = latestStatus?.ocr_reader_runtime || {};
  const fallbackItems = mergedLines.length ? mergedLines : [{
    speaker: 'OCR',
    scene_id: runtime.ocr_context_state || runtime.detail || '',
    stability: 'diagnostic',
    line_id: runtime.last_poll_completed_at || runtime.last_capture_completed_at || '',
    text: runtime.last_raw_ocr_text
      ? uiTf('ui.history.last_raw_ocr', 'Последний raw OCR: {text}', { text: runtime.last_raw_ocr_text })
      : buildOcrMissingLineDiagnostic(latestStatus || {}),
    is_diagnostic: true,
  }];
  renderStackList('linesList', fallbackItems, (item) => `
    <article class="list-card">
      <p class="list-kicker">${escapeHtml(item.is_diagnostic ? uiT('ui.history.ocr_diagnostic', 'Диагностика OCR') : (item.speaker || uiT('ui.history.narrator', 'Рассказчик')))} · ${escapeHtml(item.scene_id || '')} · ${escapeHtml(item.stability || '')}</p>
      <h3>${escapeHtml(item.is_diagnostic ? uiT('ui.history.no_stable_line', 'Стабильная реплика не записана') : (item.line_id || ''))}</h3>
      <p>${escapeHtml(item.text || '')}</p>
    </article>
  `);

  renderStackList('choicesList', history.choices || [], (item) => `
    <article class="list-card">
      <p class="list-kicker">${escapeHtml(item.action || '')} · #${escapeHtml(item.index || 0)}</p>
      <h3>${escapeHtml(item.choice_id || '')}</h3>
      <p>${escapeHtml(item.text || '')}</p>
    </article>
  `);

  renderStackList('eventsList', history.events || [], (item) => `
    <article class="list-card compact">
      <p class="list-kicker">seq ${escapeHtml(item.seq || 0)} · ${escapeHtml(item.type || '')}</p>
      <h3>${escapeHtml(item.line_id || item.scene_id || '')}</h3>
      <p>${escapeHtml(JSON.stringify(item.payload || {}))}</p>
    </article>
  `);
}

function formatInsightMeta(payload) {
  const inputSource = dataSourceLabel(
    payload.input_source || (latestStatus && latestStatus.active_data_source) || 'unknown',
    'unknown',
  );
  const semantic = rawStatusLabel(
    payload.semantic_granularity
    || (payload.semantic_degraded ? 'weaker_than_bridge_sdk' : 'bridge_sdk_level'),
  );
  const fallback = payload.fallback_used ? uiT('ui.common.yes', 'Да') : uiT('ui.common.no', 'Нет');
  return uiTf('ui.suggest.meta', 'источник ввода={inputSource} | degraded={degraded} | семантическая детализация={semantic} | fallback={fallback}', {
    inputSource,
    degraded: Boolean(payload.degraded),
    semantic,
    fallback,
  });
}

function renderAgentStatus(payload) {
  latestAgentStatus = payload || latestAgentStatus;
  const replyNode = document.getElementById('agentReplyText');
  renderPreservingScroll(replyNode, () => {
    replyNode.textContent = latestAgentReply;
  });
  const memoryCounts = payload.memory_counts || {};
  const summaryDebug = payload.debug?.summary || {};
  const summaryTaskDebug = summaryDebug.task || {};
  const summaryRows = [
    { label: 'scene_summary_line_interval', value: payload.scene_summary_line_interval || '' },
    { label: 'scene_summary_lines_since_push', value: payload.scene_summary_lines_since_push || 0 },
    { label: 'scene_summary_lines_until_push', value: payload.scene_summary_lines_until_push || 0 },
    { label: 'pending_summary_task_count', value: summaryDebug.pending_summary_task_count || summaryTaskDebug.pending_count || 0 },
    { label: 'pending_summary_tasks', value: formatDebugValue(summaryDebug.pending_summary_tasks || summaryTaskDebug.pending || []) },
    { label: 'last_delivered_summary_key', value: summaryDebug.last_delivered_summary_key || summaryTaskDebug.last_delivered_summary_key || '' },
    { label: 'last_delivered_summary_seq', value: summaryDebug.last_delivered_summary_seq || summaryTaskDebug.last_delivered_summary_seq || 0 },
    { label: 'last_delivered_summary_scene_id', value: summaryDebug.last_delivered_summary_scene_id || summaryTaskDebug.last_delivered_summary_scene_id || '' },
    { label: 'last_session_transition_type', value: payload.last_session_transition_type || '' },
    { label: 'last_session_transition_reason', value: payload.last_session_transition_reason || '' },
    { label: 'last_session_transition_fields', value: formatDebugValue(payload.last_session_transition_fields || {}) },
    { label: 'summary_thresholds', value: formatDebugValue(summaryDebug.thresholds || {}) },
    { label: 'summary_scene_states', value: formatDebugValue(summaryDebug.scene_states || []) },
    { label: 'summary_last_scheduled', value: formatDebugValue(summaryDebug.last_scheduled || {}) },
    { label: 'summary_last_drop', value: formatDebugValue(summaryDebug.last_drop || {}) },
    { label: 'summary_last_skip', value: formatDebugValue(summaryDebug.last_skip || {}) },
    { label: 'summary_last_task_cancelled', value: formatDebugValue(summaryDebug.last_task_cancelled || summaryTaskDebug.last_cancelled || {}) },
    { label: 'summary_last_task_exception', value: formatDebugValue(summaryDebug.last_task_exception || summaryTaskDebug.last_exception || {}) },
    { label: 'summary_last_task_returned_false', value: formatDebugValue(summaryDebug.last_task_returned_false || summaryTaskDebug.last_returned_false || {}) },
    { label: 'summary_last_task_restored_schedule', value: formatDebugValue(summaryDebug.last_task_restored_schedule || summaryTaskDebug.last_restored_schedule || {}) },
    { label: 'summary_last_retry_reason', value: summaryDebug.last_retry_reason || '' },
    { label: 'summary_peek_session_transition', value: formatDebugValue(summaryDebug.peek_session_transition || {}) },
  ];
  renderAgentStatusGrid([
    {
      label: 'agent_user_status',
      value: agentUserStatusLabel(payload.agent_user_status, payload.agent_user_status || ''),
    },
    { label: 'status', value: payload.status || 'standby' },
    { label: 'activity', value: payload.activity || 'idle' },
    { label: 'reason', value: payload.reason || '' },
    { label: 'diagnostic', value: payload.debug?.ocr_capture_diagnostic || payload.error || '' },
    { label: 'input_source', value: payload.input_source || (latestStatus && latestStatus.active_data_source) || 'unknown' },
    { label: 'scene_stage', value: payload.scene_stage || 'unknown' },
    { label: 'scene_id', value: payload.scene_id || '' },
    { label: 'line_id', value: payload.line_id || '' },
    { label: 'push_policy', value: payload.push_policy || 'disabled' },
    { label: 'actionable', value: String(Boolean(payload.actionable)) },
    { label: 'standby_requested', value: String(Boolean(payload.standby_requested)) },
    {
      label: 'memory_counts',
      value: `scene=${memoryCounts.scene_memory || 0} choice=${memoryCounts.choice_memory || 0} failure=${memoryCounts.failure_memory || 0}`,
    },
    { label: 'inbound_queue_size', value: String(payload.inbound_queue_size || 0) },
    { label: 'outbound_queue_size', value: String(payload.outbound_queue_size || 0) },
    {
      label: 'last_interruption',
      value: payload.last_interruption?.interrupted_message_id || '',
    },
    {
      label: 'last_outbound_message',
      value: payload.last_outbound_message?.content || '',
    },
    { label: 'result', value: payload.result || '' },
    { label: 'recent_pushes', value: String((payload.recent_pushes || []).length) },
    { label: 'bridge_tick_auto_running', value: String(Boolean(latestStatus?.bridge_tick_auto_running)) },
    { label: 'last_agent_tick_age_seconds', value: String(latestStatus?.last_agent_tick_age_seconds || 0) },
    { label: 'bridge_tick_last_error', value: latestStatus?.bridge_tick_last_error || '' },
  ], summaryRows);

  renderStackList('pushesList', payload.recent_pushes || [], (item) => `
    <article class="list-card compact">
      <p class="list-kicker">${escapeHtml(item.kind || '')} | ${escapeHtml(formatPushStatus(item))} | ${escapeHtml(item.ts || '')}</p>
      <h3>${escapeHtml(item.scene_id || '')}</h3>
      <p>${escapeHtml(item.content || '')}</p>
      ${item.error ? `<p>${escapeHtml(item.error)}</p>` : ''}
    </article>
  `);

  const panelSummary = document.getElementById('agentPanelSummary');
  if (panelSummary) {
    const mode = latestStatus?.mode || 'companion';
    const modeText = modeLabel(mode, mode);
    const inbound = payload.inbound_queue_size || 0;
    const outbound = payload.outbound_queue_size || 0;
    panelSummary.textContent = `${modeText} | in=${inbound} out=${outbound}`;
  }
}

function renderAgentStatusGrid(rows, summaryRows) {
  const container = document.getElementById('agentStatusGrid');
  const debugWasOpen = Boolean(container?.querySelector('.status-debug-panel')?.open);
  renderPreservingScroll(container, () => {
    const visibleRows = Array.isArray(rows) ? rows : [];
    const visibleSummaryRows = Array.isArray(summaryRows) ? summaryRows : [];
    if (!visibleRows.length) {
      container.className = 'data-grid scroll-region empty-state';
      container.textContent = uiT('ui.agent.empty_status', 'Agent приводит заметки в порядок и ждет первое обновление статуса.');
      return;
    }
    container.className = 'data-grid scroll-region';
    container.innerHTML = `
      ${renderDataRows(visibleRows)}
      <details class="status-debug-panel"${debugWasOpen ? ' open' : ''}>
        <summary>
          <span>${escapeHtml(uiT('ui.agent.summary_debug', 'Отладка Summary'))}</span>
          <small>${escapeHtml(uiTf('ui.agent.summary_debug_count', '{count} внутренних состояний', { count: visibleSummaryRows.length }))}</small>
        </summary>
        <dl class="data-grid">
          ${renderDataRows(visibleSummaryRows)}
        </dl>
      </details>
    `;
  });
}

function formatDebugValue(value) {
  if (value == null || value === '') {
    return '—';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value);
    return text.trim() ? text : '—';
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function formatPushStatus(item = {}) {
  const parts = [item.status || ''];
  parts.push(item.delivered ? 'delivered' : 'not_delivered');
  if (item.suppressed) {
    parts.push('suppressed');
  }
  if (Number(item.retry_count || 0) > 0) {
    parts.push(`retry=${Number(item.retry_count || 0)}`);
  }
  if (item.error) {
    parts.push('error');
  }
  return parts.filter(Boolean).join(' | ');
}

function renderSuggest(payload) {
  const node = document.getElementById('suggestPanel');
  const choices = payload.choices || [];
  renderPreservingScroll(node, () => {
    node.className = 'result-panel scroll-region';
    node.innerHTML = `
      <p class="list-kicker">${escapeHtml(payload.scene_id || '')} | ${escapeHtml(formatInsightMeta(payload))}</p>
      <div class="stack-list">
        ${choices.length ? choices.map((item) => `
          <article class="list-card compact">
            <p class="list-kicker">rank ${escapeHtml(item.rank || 0)} | ${escapeHtml(item.choice_id || '')}</p>
            <h3>${escapeHtml(item.text || '')}</h3>
            <p>${escapeHtml(item.reason || '')}</p>
          </article>
        `).join('') : `<div class="empty-inline agent-suggest-empty"><span class="agent-suggest-empty-face" aria-hidden="true">(=^..^=)</span><span>${escapeHtml(payload.diagnostic || uiT('ui.agent.empty_suggest', 'Советов пока нет. Они появятся, когда на экране будут варианты выбора.'))}</span></div>`}
      </div>
    `;
  });
  const mirror = document.getElementById('suggestPanelMirror');
  if (mirror && node) {
    mirror.innerHTML = node.innerHTML;
    mirror.className = node.className;
  }
}

async function refreshInsights(snapshot, { force = false, history = {}, status = {} } = {}) {
  const mode = String(status.mode || '').trim();
  if (mode === 'silent') {
    const diagnostic = uiT('ui.suggest.silent_diagnostic', 'Тихий режим: предложения не создаются автоматически.');
    const suggest = buildSuggestFallback('', diagnostic);
    latestInsights.suggestKey = 'silent';
    latestInsights.suggestPayload = suggest;
    const scrollState = captureRefreshScrollState();
    renderSuggest(suggest);
    restoreRefreshScrollState(scrollState);
    return;
  }

  const state = snapshot.snapshot || {};
  const fallbackLine = effectiveCurrentLine(snapshot, history, status);
  const currentSceneId = state.scene_id || fallbackLine.scene_id || '';
  const choices = Array.isArray(state.choices) ? state.choices : [];
  const visibleChoiceMenu = Boolean(state.is_menu_open) && choices.length > 0;
  const hasChoices = mode === 'choice_advisor' && visibleChoiceMenu;
  const suggestKey = hasChoices
    ? `${currentSceneId}::${choices.map((item) => `${item.choice_id || ''}:${item.text || ''}`).join('|')}`
    : `${currentSceneId}::no-choices`;

  const suggestPromise = hasChoices
    ? (force || latestInsights.suggestKey !== suggestKey || !latestInsights.suggestPayload)
      ? safeCall(
        'galgame_suggest_choice',
        {},
        buildSuggestFallback(currentSceneId),
      )
      : Promise.resolve(latestInsights.suggestPayload)
    : Promise.resolve(buildSuggestFallback(
      currentSceneId,
      visibleChoiceMenu ? uiT('ui.suggest.companion_diagnostic', 'Режим сопровождения: подсказки выбора не создаются автоматически.') : uiT('ui.const.no_visible_choices', 'видимых вариантов нет'),
    ));

  const suggest = await suggestPromise;

  latestInsights.suggestKey = suggestKey;
  latestInsights.suggestPayload = suggest;

  const scrollState = captureRefreshScrollState();
  renderSuggest(suggest);
  restoreRefreshScrollState(scrollState);
}

function renderInsightsPending(message = uiT('ui.suggest.pending', 'Подсказки выбора обновляются в фоне...')) {
  const scrollState = captureRefreshScrollState();
  renderSuggest(buildSuggestFallback('', message));
  restoreRefreshScrollState(scrollState);
}

function runBackgroundTask(label, task) {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      console.warn(`[galgame_plugin ui] ${label} failed`, error);
    });
}

function stopAutoRefresh() {
  if (autoRefreshTimer !== null) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function desiredAutoRefreshInterval(status = latestStatus) {
  if (!status || status.connection_state === 'error' || status.agent_user_status === 'error') {
    return ERROR_REFRESH_INTERVAL_MS;
  }
  if (
    status.agent_user_status === 'paused_window_not_foreground'
    || status.agent_pause_kind === 'window_not_foreground'
  ) {
    return FOCUS_PAUSE_REFRESH_INTERVAL_MS;
  }
  const runtime = status.ocr_reader_runtime || {};
  const { observedText, stableText, effectiveText } = getCurrentLineTexts(status);
  const runtimeState = textValue(runtime.status);
  const contextState = textValue(status.ocr_context_state || runtime.ocr_context_state);
  if (
    status.bridge_poll_running === true
    || status.ocr_fast_loop_running === true
    || ['starting', 'active', 'running'].includes(runtimeState)
    || ['capture_pending', 'observed'].includes(contextState)
    || runtime.stable_ocr_block_reason === 'waiting_for_repeat'
    || Number(status.pending_ocr_advance_captures || 0) > 0
  ) {
    return AUTO_REFRESH_URGENT_INTERVAL_MS;
  }
  if (
    status.connection_state === 'active'
    || runtimeState === 'active'
    || runtimeState === 'running'
    || observedText
    || stableText
    || effectiveText
  ) {
    return AUTO_REFRESH_ACTIVE_INTERVAL_MS;
  }
  return AUTO_REFRESH_IDLE_INTERVAL_MS;
}

function startAutoRefresh(intervalMs = AUTO_REFRESH_INTERVAL_MS) {
  stopAutoRefresh();
  autoRefreshIntervalMs = intervalMs;
  autoRefreshTimer = window.setInterval(() => {
    if (document.hidden) {
      return;
    }
    refreshAll({ preserveFlash: true, silent: true }).catch((error) => { console.error('[galgame] async action failed', error); });
  }, intervalMs);
}

function syncAutoRefreshIntervalForStatus(status = latestStatus) {
  const desired = desiredAutoRefreshInterval(status);
  if (autoRefreshTimer !== null && desired !== autoRefreshIntervalMs) {
    startAutoRefresh(desired);
  }
}

function isOcrWindowModalOpen() {
  const modal = document.getElementById('ocrWindowModal');
  return Boolean(modal && !modal.hidden);
}

function isMemoryProcessModalOpen() {
  const modal = document.getElementById('memoryProcessModal');
  return Boolean(modal && !modal.hidden);
}

function shouldRefreshMemoryProcessesForStatus(status) {
  const runtime = status?.memory_reader_runtime || {};
  const detail = String(runtime.target_selection_detail || runtime.detail || '');
  return (
    detail === 'no_detected_game_process'
    || detail === 'manual_target_unavailable'
    || detail === 'manual_pid_unimplemented'
    || isMemoryProcessModalOpen()
  );
}

function shouldRefreshOcrWindowsForStatus(status) {
  const runtime = status?.ocr_reader_runtime || {};
  const detail = String(runtime.target_selection_detail || '');
  const context = String(status?.ocr_context_state || runtime.ocr_context_state || '');
  return (
    context === 'waiting_for_valid_window'
    || detail === 'no_eligible_window'
    || detail === 'foreground_window_needs_manual_confirmation'
    || detail === 'auto_detect_needs_manual_fallback'
    || detail === 'memory_reader_window_minimized'
    || Number(runtime.candidate_count || 0) === 0
    || isOcrWindowModalOpen()
  );
}

function refreshMemoryProcessTargetsIfNeeded({
  reason = '',
  force = false,
  silent = true,
} = {}) {
  if (memoryProcessRefreshInFlight) {
    return memoryProcessRefreshInFlight;
  }

  const now = Date.now();
  if (!force && now - lastMemoryProcessRefreshAt < MEMORY_PROCESS_REFRESH_TTL_MS) {
    return Promise.resolve(false);
  }

  memoryProcessRefreshInFlight = refreshMemoryProcesses({
    includeUnknown: true,
    silent,
  }).then((refreshed) => {
    if (refreshed) {
      lastMemoryProcessRefreshAt = Date.now();
    }
    return Boolean(refreshed);
  }).catch((error) => {
    console.warn(`[galgame_plugin ui] refresh Memory Reader processes for ${reason || 'unknown'} failed`, error);
    if (!silent) {
      setFlash(error instanceof Error ? error.message : String(error), 'error');
    }
    return false;
  }).finally(() => {
    memoryProcessRefreshInFlight = null;
  });
  return memoryProcessRefreshInFlight;
}

function refreshOcrWindowTargetsIfNeeded({
  reason = '',
  force = false,
  silent = true,
} = {}) {
  if (ocrWindowRefreshInFlight) {
    return ocrWindowRefreshInFlight;
  }

  const now = Date.now();
  if (!force && now - lastOcrWindowRefreshAt < OCR_WINDOW_REFRESH_TTL_MS) {
    return Promise.resolve(false);
  }

  ocrWindowRefreshInFlight = refreshOcrWindowTargets({
    includeExcluded: true,
    silent,
    force,
  }).then((refreshed) => {
    if (refreshed) {
      lastOcrWindowRefreshAt = Date.now();
    }
    return Boolean(refreshed);
  }).catch((error) => {
    console.warn(`[galgame_plugin ui] refresh OCR window targets for ${reason || 'unknown'} failed`, error);
    if (!silent) {
      setFlash(error instanceof Error ? error.message : String(error), 'error');
    }
    return false;
  }).finally(() => {
    ocrWindowRefreshInFlight = null;
  });
  return ocrWindowRefreshInFlight;
}

function refreshOcrWindowsOnPageFocus() {
  if (document.hidden) {
    return;
  }
  refreshOcrWindowTargetsIfNeeded({
    reason: 'page_focus',
    silent: true,
  }).catch((error) => { console.error('[galgame] async action failed', error); });
}

async function refreshAll(options = {}) {
  const {
    preserveFlash = false,
    silent = false,
    forceInsights = false,
    insightMode = 'background',
    showInsightPending = false,
    forceRefresh = false,
  } = options;
  if (refreshInFlight) {
    if (!forceRefresh) {
      return refreshInFlight;
    }
    try {
      await refreshInFlight;
    } catch (error) {
      console.warn('[galgame_plugin ui] ignored stale refresh before forced refresh', error);
    }
  }

  refreshInFlight = (async () => {
    if (!preserveFlash && !silent) {
      setFlash('', 'info');
    }
    try {
      const [status, snapshot, history] = await Promise.all([
        callPlugin('galgame_get_status', {}, { timeoutMs: PLUGIN_RUN_LIGHT_TIMEOUT_MS }),
        callPlugin('galgame_get_snapshot', {}, { timeoutMs: PLUGIN_RUN_LIGHT_TIMEOUT_MS }),
        callPlugin('galgame_get_history', { limit: 20, include_events: true }, { timeoutMs: PLUGIN_RUN_LIGHT_TIMEOUT_MS }),
      ]);
      const scrollState = captureRefreshScrollState();
      const agentStatus = status.agent || buildAgentStatusFromStatus(status);
      latestSnapshotData = snapshot;
      renderStatus(status);
      renderHistory(history);
      renderAgentStatus(agentStatus);
      restoreRefreshScrollState(scrollState);
      if (shouldRefreshMemoryProcessesForStatus(status)) {
        runBackgroundTask('refresh Memory Reader processes after status', () => (
          refreshMemoryProcessTargetsIfNeeded({
            reason: 'status_needs_memory_process_refresh',
            silent: true,
          })
        ));
      }
      if (shouldRefreshOcrWindowsForStatus(status)) {
        const snapshotWindows = latestOcrWindowSnapshot && Array.isArray(latestOcrWindowSnapshot.windows)
          ? latestOcrWindowSnapshot.windows
          : [];
        const forceEmptyFocusedRefresh = Boolean(
          !emptyOcrWindowFocusForceRefreshDone
          && !document.hidden
          && document.hasFocus()
          && snapshotWindows.length === 0
          && Number((status.ocr_reader_runtime || {}).candidate_count || 0) === 0
        );
        if (forceEmptyFocusedRefresh) {
          emptyOcrWindowFocusForceRefreshDone = true;
        }
        runBackgroundTask('refresh OCR window targets after status', () => (
          refreshOcrWindowTargetsIfNeeded({
            reason: 'status_needs_window_refresh',
            force: forceEmptyFocusedRefresh,
            silent: true,
          })
        ));
      }
      if (shouldRefreshCharacterProfilesForStatus(status)) {
        runBackgroundTask('refresh character profiles after status', () => (
          refreshCharacterProfiles({
            reason: 'status_needs_character_profile_refresh',
            silent: true,
          })
        ));
      }
      if (showInsightPending && !latestInsights.suggestPayload) {
        renderInsightsPending();
      }
      if (insightMode !== 'none') {
        const insightRefresh = refreshInsights(snapshot, { force: forceInsights, history, status });
        if (insightMode === 'blocking') {
          await insightRefresh;
        } else {
          insightRefresh.catch((error) => {
            console.warn('[galgame_plugin ui] background insight refresh failed', error);
          });
        }
      }
      return true;
    } catch (error) {
      renderPluginUnavailable(error);
      if (silent) {
        console.warn('[galgame_plugin ui] refresh failed', error);
        return false;
      }
      if (isPluginNotStartedError(error)) {
        setFlash(uiT('ui.flash.plugin_not_started', 'Плагин еще не запущен. Нажмите "Запустить" на странице управления плагинами.'), 'info');
      } else {
        setFlash(error instanceof Error ? error.message : String(error), 'error');
      }
      return false;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function buildAgentStatusFromStatus(status = {}) {
  return {
    action: 'peek_status',
    result: status.agent_error || '',
    status: status.agent_status || 'standby',
    agent_user_status: status.agent_user_status || '',
    activity: status.agent_activity || '',
    reason: status.agent_reason || '',
    error: status.agent_error || '',
    inbound_queue_size: status.agent_inbound_queue_size || 0,
    outbound_queue_size: status.agent_outbound_queue_size || 0,
    last_interruption: status.agent_last_interruption || {},
    last_outbound_message: status.agent_last_outbound_message || {},
    debug: {
      ocr_capture_diagnostic: status.agent_diagnostic || status.ocr_capture_diagnostic || '',
    },
    recent_pushes: latestAgentStatus?.recent_pushes || [],
  };
}

async function withButtonPending(buttonOrId, pendingText, fn) {
  const button = typeof buttonOrId === 'string'
    ? document.getElementById(buttonOrId)
    : buttonOrId;
  if (!button) {
    return fn();
  }
  const originalText = button.textContent;
  const originalDisabled = button.disabled;
  button.disabled = true;
  button.textContent = pendingText;
  try {
    return await fn();
  } finally {
    button.disabled = originalDisabled;
    button.textContent = originalText;
    if (String(button.id || '').startsWith('characterProfile')) {
      renderCharacterProfilePanel(latestStatus);
    }
  }
}

async function startInstall(kind, force = false, { navigate = true } = {}) {
  const config = getInstallConfig(kind);

  // Caller may already have positioned the viewport on a specific card
  // (e.g. handleDiagnosisAction routes to rapidocrCard before kicking off
  // the download); the unconditional `navigateToInstallPanel(kind)` would
  // re-snap the viewport to plugin settings on the next frame and undo
  // that careful scroll. The opt-out lets such callers reuse the existing
  // positioning. The default `navigate: true` preserves the original
  // textractor install flow behavior.
  if (navigate) {
    navigateToInstallPanel(kind);
  }

  const state = getInstallState(kind);
  const { button } = getInstallNodes(kind);
  state.generation = Number(state.generation || 0) + 1;
  state.currentTaskId = null;
  clearPersistedInstallTaskId(kind);
  state.inProgress = true;
  state.state = {
    kind,
    task_id: '',
    status: 'queued',
    phase: 'queued',
    message: uiTf('ui.install.task.creating', 'Создание фоновой задачи установки {label}...', { label: config.label }),
    progress: 0.01,
    updated_at: Date.now() / 1000,
  };
  closeInstallStream(kind);
  clearInstallReconnectTimer(kind);
  if (button) {
    button.disabled = true;
    button.textContent = uiT('ui.pending.installing', 'Подготовка установки...');
  }
  if (latestStatus) {
    renderStatus(latestStatus);
  } else {
    renderInstallTaskState(kind);
  }
  setFlash(config.queuedFlash, 'info');

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
    });
    if (!response.ok) {
      throw new Error(uiTf('ui.error.install_task_create_failed', 'Не удалось создать задачу установки {label}: HTTP {status}', {
        label: config.label,
        status: response.status,
      }));
    }

    const payload = await response.json();
    const taskId = payload.task_id || payload.run_id;
    if (!taskId) {
      throw new Error(uiTf('ui.error.install_task_id_missing', 'Не получен task_id установки {label}', { label: config.label }));
    }

    state.currentTaskId = taskId;
    persistInstallTaskId(kind, taskId);
    if (payload.state) {
      applyInstallTaskState(kind, payload.state, { allowRefresh: true });
    }
    connectInstallStream(kind, taskId);

    const initialState = await fetchInstallTaskState(kind, taskId);
    if (initialState) {
      applyInstallTaskState(kind, initialState, { allowRefresh: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.inProgress = false;
    state.state = {
      kind,
      task_id: state.currentTaskId || '',
      status: 'failed',
      phase: 'failed',
      message,
      error: message,
      progress: 1,
      updated_at: Date.now() / 1000,
    };
    if (latestStatus) {
      renderStatus(latestStatus);
    } else {
      renderInstallTaskState(kind);
    }
    setFlash(message, 'error');
  }
}

async function setOcrBackendSelection({ backendSelection = null, captureBackend = null } = {}) {
  const args = {};
  if (backendSelection) {
    args.backend_selection = backendSelection;
  }
  if (captureBackend) {
    args.capture_backend = captureBackend;
  }
  const label = backendSelection
    ? uiTf('ui.ocr.backend_selection_label', 'OCR-бэкенд переключен на {backend}', { backend: backendSelection })
    : uiTf('ui.ocr.capture_backend_selection_label', 'Бэкенд захвата переключен на {backend}', { backend: captureBackend });
  try {
    setFlash(uiTf('ui.flash.saving_named_setting', 'Сохранение {label}...', { label }), 'info');
    await callPlugin('galgame_set_ocr_backend', args);
    setFlash(uiTf('ui.flash.named_setting_saved', '{label} сохранено', { label }), 'success');
    await refreshAll({ preserveFlash: true, forceInsights: true });
  } catch (error) {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function setRapidOcrLang(payload = {}) {
  if (rapidOcrLangRequestPending) {
    rapidOcrLangQueuedPayload = { ...payload };
    setFlash(uiT('ui.flash.saving_rapidocr_lang', 'Сохранение языка распознавания RapidOCR...'), 'info');
    return;
  }
  rapidOcrLangRequestPending = true;
  setRapidOcrLangControlsDisabled(true);
  let saved = false;
  try {
    setFlash(uiT('ui.flash.saving_rapidocr_lang', 'Сохранение языка распознавания RapidOCR...'), 'info');
    const result = await callPlugin('galgame_set_rapidocr_lang', payload);
    saved = true;
    if (!rapidOcrLangQueuedPayload) {
      setFlash(result.summary || uiT('ui.flash.rapidocr_lang_saved', 'Язык распознавания RapidOCR сохранён'), 'success');
    }
  } catch (error) {
    if (!rapidOcrLangQueuedPayload) {
      setFlash(error instanceof Error ? error.message : String(error), 'error');
    }
  } finally {
    rapidOcrLangRequestPending = false;
    const nextPayload = rapidOcrLangQueuedPayload;
    rapidOcrLangQueuedPayload = null;
    if (nextPayload) {
      setRapidOcrLang(nextPayload);
    } else {
      const checkbox = document.getElementById('rapidocrAutoDetectCheck');
      const latestRapidOcr = latestStatus && latestStatus.rapidocr ? latestStatus.rapidocr : {};
      const autoDetect = checkbox ? checkbox.checked : latestRapidOcr.auto_detect_lang !== false;
      if (latestStatus && latestStatus.rapidocr) {
        renderRapidOcrLangBar({ ...latestRapidOcr, auto_detect_lang: autoDetect });
      } else if (!autoDetect && !rapidOcrLangRequestPending) {
        setRapidOcrLangControlsDisabled(false);
      }
    }
    if (saved && !nextPayload) {
      await refreshAll({ preserveFlash: true, forceInsights: true });
    }
  }
}

function clearSettingsAutosaveTimer() {
  if (settingsAutosaveTimer) {
    clearTimeout(settingsAutosaveTimer);
    settingsAutosaveTimer = null;
  }
}

function scheduleSettingsAutosave() {
  clearSettingsAutosaveTimer();
  settingsAutosaveTimer = window.setTimeout(() => {
    settingsAutosaveTimer = null;
    if (!settingsDirty || settingsSaveInFlight) {
      return;
    }
    saveMode({ auto: true }).catch((error) => {
      setFlash(error instanceof Error ? error.message : String(error), 'error');
    });
  }, SETTINGS_AUTOSAVE_DELAY_MS);
}

async function saveMode({ auto = false } = {}) {
  let modeCommitted = false;
  clearSettingsAutosaveTimer();
  const mode = document.getElementById('modeSelect').value;
  const pushNotifications = document.getElementById('pushToggle').checked;
  const advanceSpeed = document.getElementById('advanceSpeedSelect').value || 'medium';
  const readerMode = document.getElementById('readerModeSelect')?.value || 'auto';
  const ocrPollIntervalRaw = document.getElementById('ocrPollIntervalInput')?.value || '';
  const ocrPollInterval = Number(ocrPollIntervalRaw || 0.5);
  const ocrTriggerMode = document.getElementById('ocrTriggerModeSelect')?.value || 'interval';
  const visionEnabled = Boolean(document.getElementById('llmVisionToggle')?.checked);
  const fastLoopEnabled = Boolean(document.getElementById('fastLoopToggle')?.checked);
  const visionMaxRaw = document.getElementById('llmVisionMaxImagePxInput')?.value || '';
  const visionMaxImagePx = Number(visionMaxRaw || 768);
  if (!['auto', 'memory_reader', 'ocr_reader'].includes(readerMode)) {
    setFlash(uiT('ui.flash.invalid_reader_mode', 'Недопустимый режим чтения текста.'), 'error');
    clearPendingModeSelection(mode);
    return;
  }
  if (!Number.isFinite(ocrPollInterval) || ocrPollInterval < 0.5 || ocrPollInterval > 10) {
    setFlash(uiT('ui.flash.invalid_ocr_interval', 'Интервал OCR/DXcam должен быть от 0.5 до 10 секунд.'), 'error');
    clearPendingModeSelection(mode);
    return;
  }
  if (!['interval', 'after_advance'].includes(ocrTriggerMode)) {
    setFlash(uiT('ui.flash.invalid_ocr_trigger', 'Недопустимый режим запуска OCR.'), 'error');
    clearPendingModeSelection(mode);
    return;
  }
  if (!Number.isFinite(visionMaxImagePx) || visionMaxImagePx < 64 || visionMaxImagePx > 2048) {
    setFlash(uiT('ui.flash.invalid_vision_max', 'Максимальная сторона Vision должна быть от 64 до 2048.'), 'error');
    clearPendingModeSelection(mode);
    return;
  }
  const requestId = ++modeSaveRequestId;
  try {
    if (mode && (!latestStatus || latestStatus.mode !== mode)) {
      pendingModeSelection = mode;
      updateModeSwitchControl(mode);
      updateSummaryMode(mode);
    }
    settingsSaveInFlight = true;
    updateSettingsDirtyHint(auto ? uiT('ui.pending.auto_saving', 'Автосохранение...') : uiT('ui.pending.saving', 'Сохранение...'));
    setFlash(auto ? uiT('ui.flash.auto_saving_settings', 'Автосохранение настроек...') : uiT('ui.flash.saving_settings', 'Сохранение настроек...'), 'info');
    await callPlugin('galgame_set_mode', {
      mode,
      push_notifications: pushNotifications,
      advance_speed: advanceSpeed,
      reader_mode: readerMode,
    });
    modeCommitted = true;
    const ttsPipeline = getSelectedTtsPipeline();
    await callPlugin('galgame_set_tts_pipeline', { pipeline: ttsPipeline });
    if (latestStatus) latestStatus.tts_output_pipeline = ttsPipeline;
    await callPlugin('galgame_set_ocr_timing', {
      poll_interval_seconds: ocrPollInterval,
      trigger_mode: ocrTriggerMode,
      fast_loop_enabled: fastLoopEnabled,
    });
    await callPlugin('galgame_set_llm_vision', {
      vision_enabled: visionEnabled,
      vision_max_image_px: Math.round(visionMaxImagePx),
    });
    if (requestId !== modeSaveRequestId) {
      return;
    }
    setFlash(auto ? uiT('ui.flash.settings_auto_saved', 'Настройки автосохранены') : uiT('ui.flash.settings_saved', 'Настройки сохранены'), 'success');
    settingsDirty = false;
    settingsSaveInFlight = false;
    updateSettingsDirtyHint();
    await refreshAll({ preserveFlash: true, forceInsights: true, forceRefresh: true });
  } catch (error) {
    if (requestId !== modeSaveRequestId) {
      console.error('[galgame] stale saveMode error suppressed', error);
      return;
    }
    if (modeCommitted) {
      try {
        await refreshAll({ preserveFlash: true, forceRefresh: true });
      } catch (refreshError) {
        console.error('[galgame] mode save reconcile refresh failed', refreshError);
      }
    } else {
      clearPendingModeSelection(mode);
    }
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    if (requestId === modeSaveRequestId) {
      settingsSaveInFlight = false;
      updateSettingsDirtyHint();
    }
  }
}

async function bindGame(gameId = '') {
  const normalized = String(gameId || '').trim();
  try {
    setFlash(normalized
      ? uiTf('ui.flash.binding_game', 'Привязка {gameId}...', { gameId: normalized })
      : uiT('ui.flash.restoring_auto_select', 'Восстановление авто выбора...'), 'info');
    await callPlugin('galgame_bind_game', { game_id: normalized });
    setFlash(normalized
      ? uiTf('ui.flash.game_bound', '{gameId} привязан', { gameId: normalized })
      : uiT('ui.flash.auto_select_restored', 'Авто выбор восстановлен'), 'success');
    latestCharacterProfileSnapshot = null;
    lastCharacterProfileGameId = '';
    await refreshAll({ preserveFlash: true, forceInsights: true });
    await refreshCharacterProfiles({ force: true, silent: true });
  } catch (error) {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function setStandby(standby) {
  try {
    setFlash(standby ? uiT('ui.flash.entering_standby', 'Переход в ожидание...') : uiT('ui.flash.resuming_active', 'Возврат к активности...'), 'info');
    const payload = await callPlugin('galgame_agent_command', {
      action: 'set_standby',
      standby,
    });
    latestAgentReply = payload.result || latestAgentReply;
    setFlash(standby ? uiT('ui.flash.standby_enabled', 'Переключено в ожидание') : uiT('ui.flash.active_resumed', 'Активность восстановлена'), 'success');
    refreshAll({ preserveFlash: true, forceInsights: true }).catch((error) => {
      console.warn('[galgame_plugin ui] refresh after standby change failed', error);
    });
  } catch (error) {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function resumeAgentFromButton() {
  const action = document.getElementById('standbyOffBtn').dataset.resumeAction || 'noop';
  if (action === 'focus') {
    setFlash(uiT('ui.flash.resume_focus_pause', 'Текущая пауза вызвана потерей фокуса окна. Вернитесь к окну игры, и Agent продолжит автоматически; кнопка возобновления снимает только ручное ожидание.'), 'info');
    refreshAll({ preserveFlash: true, silent: true }).catch((error) => { console.error('[galgame] async action failed', error); });
    return;
  }
  if (action === 'read_only') {
    setFlash(uiT('ui.flash.resume_read_only_mode', 'Текущий режим сопровождения/тишины не нажимает автоматически. Для автопродвижения переключитесь на Auto Advance.'), 'info');
    return;
  }
  if (action === 'noop') {
    setFlash(uiT('ui.flash.no_manual_standby', 'Agent не находится в ручном ожидании.'), 'info');
    return;
  }
  await setStandby(false);
}

async function askAgent(action) {
  const prompt = document.getElementById('agentPromptInput')?.value.trim() || '';
  if (!prompt) {
    setFlash(uiT('ui.flash.agent_prompt_required', 'Введите текст для отправки Agent'), 'error');
    return;
  }

  try {
    setFlash(action === 'query_context' ? uiT('ui.flash.querying_context', 'Запрос контекста...') : uiT('ui.flash.sending_agent', 'Отправка Agent...'), 'info');
    const payload = await callPlugin(
      'galgame_agent_command',
      action === 'query_context'
        ? { action, context_query: prompt }
        : { action, message: prompt },
    );
    latestAgentReply = payload.result || uiT('ui.agent.no_reply', 'Agent не вернул текст');
    setFlash(uiT('ui.flash.agent_responded', 'Agent ответил'), 'success');
    await refreshAll({ preserveFlash: true, forceInsights: true });
  } catch (error) {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  }
}

function readProfileNumber(id, label) {
  const raw = document.getElementById(id).value.trim();
  const value = Number(raw);
  if (!raw) {
    throw new Error(uiTf('ui.error.field_required', '{field} обязательно', { field: label }));
  }
  if (!Number.isFinite(value)) {
    throw new Error(uiTf('ui.error.field_must_be_number', '{field} должно быть числом', { field: label }));
  }
  if (value < 0 || value >= 1) {
    throw new Error(uiTf('ui.error.field_range_0_099', '{field} должно быть между 0.00 и 0.99', { field: label }));
  }
  return value;
}

async function saveOcrCaptureProfile() {
  try {
    const processName = document.getElementById('ocrProfileProcessInput').value.trim();
    const stage = document.getElementById('ocrProfileStageSelect').value || 'default';
    const saveScope = normalizeCaptureProfileSaveScope(
      document.getElementById('ocrProfileSaveScopeSelect').value,
    );
    const leftInsetRatio = readProfileNumber('ocrProfileLeftInput', 'left_inset_ratio');
    const rightInsetRatio = readProfileNumber('ocrProfileRightInput', 'right_inset_ratio');
    const topRatio = readProfileNumber('ocrProfileTopInput', 'top_ratio');
    const bottomInsetRatio = readProfileNumber('ocrProfileBottomInput', 'bottom_inset_ratio');
    const payload = await callPlugin('galgame_set_ocr_capture_profile', {
      process_name: processName,
      stage,
      save_scope: saveScope,
      left_inset_ratio: leftInsetRatio,
      right_inset_ratio: rightInsetRatio,
      top_ratio: topRatio,
      bottom_inset_ratio: bottomInsetRatio,
      clear: false,
    });
    const gamePresetSelect = document.getElementById('ocrProfileGamePresetSelect');
    if (gamePresetSelect) {
      gamePresetSelect.value = 'auto';
    }
    setFlash(payload.summary || uiT('ui.flash.ocr_profile_saved', 'Калибровка снимка OCR сохранена'), 'success');
    await refreshAll({ preserveFlash: true, forceInsights: true });
  } catch (error) {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function clearOcrCaptureProfile() {
  try {
    const processName = document.getElementById('ocrProfileProcessInput').value.trim();
    const stage = document.getElementById('ocrProfileStageSelect').value || 'default';
    const saveScope = normalizeCaptureProfileSaveScope(
      document.getElementById('ocrProfileSaveScopeSelect').value,
    );
    const payload = await callPlugin('galgame_set_ocr_capture_profile', {
      process_name: processName,
      stage,
      save_scope: saveScope,
      clear: true,
    });
    setFlash(payload.summary || uiT('ui.flash.ocr_profile_cleared', 'Калибровка снимка OCR очищена'), 'success');
    await refreshAll({ preserveFlash: true, forceInsights: true });
  } catch (error) {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function autoRecalibrateOcrDialogueProfile() {
  try {
    const payload = await callPlugin('galgame_auto_recalibrate_ocr_dialogue_profile', {});
    const sampleText = String(payload.sample_text || '').trim();
    const summary = payload.summary || uiT('ui.flash.ocr_dialogue_auto_recalibrated', 'Область диалога OCR автоматически перекалибрована');
    setFlash(sampleText ? `${summary} | ${sampleText}` : summary, 'success');
    const saveScopeSelect = document.getElementById('ocrProfileSaveScopeSelect');
    saveScopeSelect.value = 'window_bucket';
    await refreshAll({ preserveFlash: true, forceInsights: true });
  } catch (error) {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function applyRecommendedOcrCaptureProfile() {
  try {
    const autoApplyInput = document.getElementById('ocrProfileAutoApplyRecommendedInput');
    const payload = await callPlugin('galgame_apply_recommended_ocr_capture_profile', {
      confirm: true,
      enable_auto_apply: Boolean(autoApplyInput?.checked),
      allow_manual_override: false,
    });
    setFlash(payload.summary || uiT('ui.flash.ocr_recommended_profile_applied', 'Рекомендуемая калибровка снимка OCR применена'), 'success');
    await refreshAll({ preserveFlash: true, forceInsights: true });
  } catch (error) {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function rollbackOcrCaptureProfileRecommendation() {
  try {
    const payload = await callPlugin('galgame_rollback_ocr_capture_profile', {
      confirm: true,
    });
    setFlash(payload.summary || uiT('ui.flash.ocr_recommended_profile_rolled_back', 'Рекомендуемая калибровка снимка OCR откачена'), 'success');
    await refreshAll({ preserveFlash: true, forceInsights: true });
  } catch (error) {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function refreshMemoryProcesses({ includeUnknown = true, silent = false } = {}) {
  try {
    const payload = await callPlugin('galgame_list_memory_reader_processes', {
      include_unknown: Boolean(includeUnknown),
    });
    renderMemoryProcessTargetSnapshot(payload, latestStatus);
    return true;
  } catch (error) {
    if (silent) {
      console.warn('[galgame_plugin ui] refresh Memory Reader processes failed', error);
      return false;
    }
    setFlash(error instanceof Error ? error.message : String(error), 'error');
    return false;
  }
}

async function openMemoryProcessModal() {
  const modal = document.getElementById('memoryProcessModal');
  const modalList = document.getElementById('memoryProcessList');
  modal.hidden = false;
  renderPreservingScroll(modalList, () => {
    modalList.className = 'stack-list scroll-region empty-state window-candidate-list';
    modalList.textContent = uiT('ui.memory.loading_processes', 'Загрузка доступных процессов...');
  });
  const refreshed = await refreshMemoryProcessTargetsIfNeeded({
    reason: 'open_memory_process_modal',
    force: true,
    silent: false,
  });
  if (!refreshed && !latestMemoryProcessSnapshot) {
    setFlash(uiT('ui.flash.memory_process_refresh_failed', 'Не удалось обновить список процессов Memory Reader. Попробуйте позже.'), 'warning');
  }
  const snapshot = latestMemoryProcessSnapshot || {};
  renderMemoryProcessListToNode(modalList, snapshot.processes || []);
}

function closeMemoryProcessModal() {
  const modal = document.getElementById('memoryProcessModal');
  modal.hidden = true;
}

async function setMemoryProcessTarget(processKey) {
  try {
    setFlash(uiT('ui.flash.locking_memory_process', 'Блокировка процесса Memory Reader...'), 'info');
    const payload = await callPlugin('galgame_set_memory_reader_target', {
      process_key: processKey,
      clear: false,
    });
    const target = payload.process_target || {};
    setFlash(uiTf('ui.flash.memory_process_locked', 'Процесс Memory Reader заблокирован: {process}', {
      process: target.process_name || processKey || uiT('ui.memory.target_process', 'целевой процесс'),
    }), 'success');
    closeMemoryProcessModal();
    refreshAll({ preserveFlash: true, forceInsights: true }).catch((error) => {
      console.warn('[galgame_plugin ui] refresh after Memory Reader process lock failed', error);
    });
    refreshMemoryProcessTargetsIfNeeded({
      reason: 'lock_memory_process',
      force: true,
      silent: true,
    }).catch((error) => { console.error('[galgame] async action failed', error); });
  } catch (error) {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function clearMemoryProcessTarget() {
  try {
    setFlash(uiT('ui.flash.clearing_memory_process_lock', 'Очистка ручной блокировки процесса Memory Reader...'), 'info');
    await callPlugin('galgame_set_memory_reader_target', { clear: true });
    setFlash(uiT('ui.flash.memory_process_auto_restored', 'Автоопределение процесса Memory Reader восстановлено'), 'success');
    await refreshAll({ preserveFlash: true, forceInsights: true });
    refreshMemoryProcessTargetsIfNeeded({
      reason: 'clear_memory_process',
      force: true,
      silent: true,
    }).catch((error) => { console.error('[galgame] async action failed', error); });
  } catch (error) {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function refreshOcrWindowTargets({ includeExcluded = true, silent = false, force = false } = {}) {
  try {
    const payload = await callPlugin('galgame_list_ocr_windows', {
      include_excluded: Boolean(includeExcluded),
      force: Boolean(force),
    });
    renderOcrWindowTargetSnapshot(payload, latestStatus);
    return true;
  } catch (error) {
    if (silent) {
      console.warn('[galgame_plugin ui] refresh OCR window targets failed', error);
      return false;
    }
    setFlash(error instanceof Error ? error.message : String(error), 'error');
    return false;
  }
}

async function openOcrWindowModal() {
  const modal = document.getElementById('ocrWindowModal');
  const modalList = document.getElementById('ocrWindowList');
  modal.hidden = false;
  renderPreservingScroll(modalList, () => {
    modalList.className = 'stack-list scroll-region empty-state window-candidate-list';
    modalList.textContent = uiT('ui.ocr.window.loading_windows', 'Загрузка доступных игровых окон...');
  });
  const refreshed = await refreshOcrWindowTargetsIfNeeded({
    reason: 'open_window_modal',
    force: true,
    silent: false,
  });
  if (!refreshed && !latestOcrWindowSnapshot) {
    setFlash(uiT('ui.flash.ocr_window_refresh_failed', 'Не удалось обновить список окон OCR. Попробуйте позже.'), 'warning');
  }
  const snapshot = latestOcrWindowSnapshot || {};
  renderOcrWindowListToNode(modalList, snapshot.windows || []);
}

function closeOcrWindowModal() {
  const modal = document.getElementById('ocrWindowModal');
  modal.hidden = true;
}

async function setOcrWindowTarget(windowKey) {
  try {
    setFlash(uiT('ui.flash.locking_ocr_window', 'Блокировка окна распознавания OCR...'), 'info');
    const payload = await callPlugin('galgame_set_ocr_window_target', {
      window_key: windowKey,
      clear: false,
    });
    const target = payload.window_target || {};
    const targetName = target.process_name || target.normalized_title || uiT('ui.ocr.window.target_window', 'целевое окно');
    setFlash(uiTf('ui.flash.ocr_window_locked', 'Окно распознавания OCR заблокировано: {target}. Статус распознавания обновляется в фоне.', {
      target: targetName,
    }), 'success');
    closeOcrWindowModal();
    refreshAll({ preserveFlash: true, forceInsights: true }).catch((error) => {
      console.warn('[galgame_plugin ui] refresh after OCR window lock failed', error);
    });
    refreshOcrWindowTargetsIfNeeded({
      reason: 'lock_window_target',
      force: true,
      silent: true,
    }).catch((error) => { console.error('[galgame] async action failed', error); });
  } catch (error) {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function clearOcrWindowTarget() {
  try {
    setFlash(uiT('ui.flash.clearing_ocr_window', 'Очистка целевого окна OCR...'), 'info');
    const payload = await callPlugin('galgame_set_ocr_window_target', {
      clear: true,
    });
    setFlash(payload.summary || uiT('ui.flash.ocr_window_cleared', 'Целевое окно OCR очищено. Плагин снова попробует автоопределение; если распознавание не сработает, выберите окно вручную.'), 'success');
    refreshAll({ preserveFlash: true, forceInsights: true }).catch((error) => {
      console.warn('[galgame_plugin ui] refresh after OCR target clear failed', error);
    });
    refreshOcrWindowTargetsIfNeeded({
      reason: 'clear_window_target',
      force: true,
      silent: true,
    }).catch((error) => { console.error('[galgame] async action failed', error); });
  } catch (error) {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  }
}

async function clearOcrWindowTargetWithFeedback() {
  await withButtonPending('ocrWindowAutoBtn', uiT('ui.pending.clearing', 'Очистка...'), clearOcrWindowTarget);
}

function expandAndScrollTo(elementId) {
  const node = document.getElementById(elementId);
  if (!node) {
    return;
  }
  const details = node.closest('details');
  if (details) {
    details.open = true;
  }
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function revealDebugDetails() {
  expandAndScrollTo('ocrRuntimeGrid');
}

function revealLineDetails() {
  expandAndScrollTo('currentLineOverview');
}

function revealCaptureBackendSettings() {
  navigateToInstallPanel('dxcam', { scrollToSection: false });
  expandAndScrollTo('dxcamCard');
}

async function refreshStatusAndWindowsFromAction() {
  setFlash(uiT('ui.flash.refreshing_status_and_windows', 'Обновление статуса и списка окон...'), 'info');
  const loaded = await refreshAll({ preserveFlash: true, forceInsights: true, showInsightPending: true });
  const windowsLoaded = loaded
    ? await refreshOcrWindowTargetsIfNeeded({
      reason: 'primary_diagnosis',
      force: true,
      silent: false,
    })
    : false;
  setFlash(
    loaded
      ? (windowsLoaded
        ? uiT('ui.flash.status_and_windows_refreshed', 'Статус и список окон обновлены.')
        : uiT('ui.flash.status_refreshed_windows_failed', 'Статус обновлен; список окон обновить не удалось. Попробуйте позже.'))
      : uiT('ui.flash.status_refresh_failed', 'Не удалось обновить статус. Попробуйте позже.'),
    loaded && windowsLoaded ? 'success' : 'warning',
  );
}

async function switchToChoiceAdvisorMode() {
  const modeSelect = document.getElementById('modeSelect');
  if (modeSelect) {
    modeSelect.value = 'choice_advisor';
  }
  await saveMode();
}

async function fetchTutorialProgress() {
  try {
    const response = await fetchWithTutorialTimeout(TUTORIAL_STATUS_URL, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    latestTutorialProgress = payload && payload.progress ? payload.progress : null;
    return latestTutorialProgress;
  } catch (error) {
    return null;
  }
}

async function saveTutorialProgress(partial) {
  const save = tutorialProgressSaveQueue.catch(() => {}).then(async () => {
    const response = await fetchWithTutorialTimeout(TUTORIAL_PROGRESS_URL, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial || {}),
    });
    if (!response.ok) {
      throw new Error(`tutorial progress save failed: HTTP ${response.status}`);
    }
    const data = await response.json();
    if (data && data.progress) {
      latestTutorialProgress = data.progress;
    }
    return latestTutorialProgress;
  });
  tutorialProgressSaveQueue = save.catch(() => {});
  return save;
}

async function resetTutorialGuide() {
  onboardingDismissed = false;
  forceShowOnboarding = true;
  lastSavedStepIndex = -1;
  latestTutorialProgress = null;
  clearSkipOnboarding();
  const resetProgress = {
    completed: false,
    skipped: false,
    last_step_index: 0,
    started_at: Date.now() / 1000,
    completed_at: 0,
  };
  try {
    await saveTutorialProgress(resetProgress);
    lastSavedStepIndex = 0;
    latestTutorialProgress = {
      ...resetProgress,
      ...(latestTutorialProgress || {}),
    };
  } catch (error) {
    console.warn('[galgame_plugin ui] tutorial reset progress save failed', error);
  }
  const onboardingView = document.getElementById('onboardingView');
  if (onboardingView) {
    onboardingView.hidden = false;
  }
  document.body.classList.add('onboarding-active');
  await refreshStatusAndWindowsFromAction();
}

async function handleDiagnosisAction(action) {
  switch (action) {
    case 'refresh_all':
      await refreshStatusAndWindowsFromAction();
      break;
    case 'refresh_ocr_windows':
      await refreshStatusAndWindowsFromAction();
      break;
    case 'select_ocr_window':
      await openOcrWindowModal();
      break;
    case 'debug_details':
      revealDebugDetails();
      setFlash(uiT('ui.flash.debug_details_expanded', 'Детали отладки runtime OCR раскрыты.'), 'info');
      break;
    case 'line_details':
      revealLineDetails();
      setFlash(uiT('ui.flash.line_details_revealed', 'Открыты детали распознавания текущей реплики.'), 'info');
      break;
    case 'recalibrate_ocr':
      await autoRecalibrateOcrDialogueProfile();
      break;
    case 'download_rapidocr_models':
      navigateToInstallPanel('rapidocr', { scrollToSection: false });
      expandAndScrollTo('rapidocrCard');
      await startInstall('rapidocr_models', false, { navigate: false });
      break;
    case 'show_rapidocr_models_guide':
      navigateToInstallPanel('rapidocr', { scrollToSection: false });
      expandAndScrollTo('rapidocrCard');
      setFlash(uiT('ui.flash.rapidocr_manual_guide_revealed', 'Переход к инструкции по моделям RapidOCR. Используйте источник скачивания и целевой каталог на карточке, чтобы вручную разместить файлы моделей.'), 'info');
      break;
    case 'install_dxcam':
      if (hasInstallFlow('dxcam')) {
        await startInstall('dxcam', false);
      } else {
        navigateToInstallPanel('dxcam', { scrollToSection: false });
        expandAndScrollTo('dxcamCard');
        setFlash(uiT('ui.flash.dxcam_hint_revealed', 'Перешли к баннеру состояния DXcam. Следуйте инструкциям на баннере (переустановить упакованную сборку / uv sync --group galgame).'), 'info');
      }
      break;
    case 'capture_backend':
      revealCaptureBackendSettings();
      setFlash(uiT('ui.flash.capture_backend_settings_revealed', 'Открыты настройки способа захвата. Можно переключить DXcam, MSS, PyAutoGUI или PrintWindow.'), 'info');
      break;
    case 'install_textractor':
      await startInstall('textractor', false);
      break;
    case 'choice_advisor':
      await switchToChoiceAdvisorMode();
      break;
    case 'reset_tutorial':
      await resetTutorialGuide();
      break;
    case 'focus_game':
      setFlash(uiT('ui.flash.focus_game_window', 'Вернитесь в окно игры. Когда оно снова будет на переднем плане, распознавание продолжится при следующем обновлении.'), 'info');
      break;
    default:
      setFlash(uiT('ui.flash.action_unavailable', 'Это действие пока недоступно.'), 'warning');
      break;
  }
}

function isFirstRunInstallAction(action) {
  return action === 'install_dxcam'
    || action === 'download_rapidocr_models'
    || action === 'show_rapidocr_models_guide';
}

function handleFirstRunActionClick(button, action) {
  return withButtonPending(button, uiT('ui.pending.processing', 'Обработка...'), () => {
    if (isFirstRunInstallAction(action)) {
      hideOnboardingWithoutSkipping();
    }
    return handleDiagnosisAction(action);
  });
}

function setPluginSettingsTab(name = 'recognition') {
  const panel = document.getElementById('pluginSettingsPanel');
  const tabs = Array.from(panel?.querySelectorAll('[data-settings-tab]') || []);
  const requestedName = name || 'recognition';
  const activeName = tabs.some((tab) => tab.getAttribute('data-settings-tab') === requestedName)
    ? requestedName
    : 'recognition';
  tabs.forEach((tab) => {
    const active = tab.getAttribute('data-settings-tab') === activeName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const tabPanels = panel?.querySelectorAll('[data-settings-tab-panel]') || [];
  tabPanels.forEach((tabPanel) => {
    const active = tabPanel.getAttribute('data-settings-tab-panel') === activeName;
    tabPanel.hidden = !active;
    tabPanel.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
}

function syncPluginStatusSectionLabels() {
  const collapseLabel = uiT('ui.button.collapse', 'Скрыть');
  const expandLabel = uiT('ui.button.expand', 'Развернуть');
  document.querySelectorAll('.plugin-status-section').forEach((section) => {
    const summary = section.querySelector('.plugin-status-section-head');
    if (!summary) {
      return;
    }
    summary.setAttribute('data-label-collapse', collapseLabel);
    summary.setAttribute('data-label-expand', expandLabel);
    summary.setAttribute('aria-expanded', section.hasAttribute('open') ? 'true' : 'false');
  });
}

function syncPluginStatusHubSummaryLabels() {
  const hub = document.querySelector('.plugin-status-hub');
  const summary = hub?.querySelector('.plugin-status-hub-summary');
  if (!hub || !summary) {
    return;
  }
  const collapseLabel = uiT('ui.button.collapse', 'Скрыть');
  const expandLabel = uiT('ui.button.expand', 'Развернуть');
  const titleLabel = uiT('ui.plugin_status.title', 'Состояние плагина');
  const isOpen = hub.hasAttribute('open');
  summary.setAttribute('data-label-collapse', collapseLabel);
  summary.setAttribute('data-label-expand', expandLabel);
  summary.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  summary.setAttribute('aria-label', `${titleLabel} ${isOpen ? collapseLabel : expandLabel}`);
}

function initPluginStatusHubSummaryLabels() {
  const hub = document.querySelector('.plugin-status-hub');
  if (hub && hub.getAttribute('data-summary-labels-ready') !== 'true') {
    hub.setAttribute('data-summary-labels-ready', 'true');
    hub.addEventListener('toggle', syncPluginStatusHubSummaryLabels);
  }
  document.querySelectorAll('.plugin-status-section').forEach((section) => {
    if (section.getAttribute('data-summary-labels-ready') !== 'true') {
      section.setAttribute('data-summary-labels-ready', 'true');
      section.addEventListener('toggle', syncPluginStatusSectionLabels);
    }
  });
  syncPluginStatusSectionLabels();
  syncPluginStatusHubSummaryLabels();
}

function navigateToInstallPanel(kind, { scrollToSection = true } = {}) {
  const advancedSettings = document.getElementById('advancedSettings');
  const advancedToggleBtn = document.getElementById('advancedToggleBtn');
  const pluginSettingsPanel = document.getElementById('pluginSettingsPanel');

  if (advancedSettings && !advancedSettings.classList.contains('open')) {
    advancedSettings.classList.add('open');
    if (advancedToggleBtn) {
      advancedToggleBtn.textContent = uiT('ui.advanced.collapse_settings', 'Свернуть расширенные настройки');
    }
    const firstRunGuide = document.getElementById('firstRunGuide');
    if (firstRunGuide) {
      firstRunGuide.hidden = true;
    }
  }

  applyPluginSettingsCollapsed(false);
  setPluginSettingsTab('dependency');

  if (scrollToSection && pluginSettingsPanel) {
    requestAnimationFrame(() => {
      pluginSettingsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

async function initialize() {
  initializePanelFullscreenControls();
  initCurrentLineUiPrefs();
  initPipelineZoom();
  initPipelineCollapse();
  initOcrWindowCollapse();
  initPluginWindowCollapse();
  initPluginSettingsCollapse();
  initPluginStatusHubSummaryLabels();
  updateSettingsDirtyHint();

  const progress = await fetchTutorialProgress();
  const skipOnboarding = readSkipOnboarding() || Boolean(progress && (progress.completed || progress.skipped));
  if (!skipOnboarding) {
    onboardingDismissed = false;
    document.body.classList.add('onboarding-active');
    const onboardingView = document.getElementById('onboardingView');
    if (onboardingView) { onboardingView.hidden = false; }
    try {
      await saveTutorialProgress({
        started_at: Number(progress?.started_at || 0) || Date.now() / 1000,
      });
    } catch (error) {
      console.warn('[galgame_plugin ui] tutorial initial progress save failed', error);
    }
  } else {
    onboardingDismissed = true;
    forceShowOnboarding = false;
    // Sync DOM with the dismissed flag. Without this, an initial render
    // pass that placed the onboarding overlay before this branch ran
    // (e.g. completed/skipped progress arrives mid-frame) would leave
    // `onboardingView` visible and `onboarding-active` on body — the
    // dismissed flag alone won't actively hide it again on the next render.
    document.body.classList.remove('onboarding-active');
    const onboardingView = document.getElementById('onboardingView');
    if (onboardingView) {
      onboardingView.hidden = true;
    }
  }

  storageRemove(`${PLUGIN_ID}:last_ui_state:v1`);
  renderInsightsPending(uiT('ui.suggest.initial_pending', 'Ожидание первого обновления статуса; подсказки выбора будут обновляться в фоне.'));
    setFlash(uiT('ui.flash.loading_status', 'Загрузка состояния плагина...'), 'info');
  const loaded = await refreshAll({ forceInsights: false, showInsightPending: true });
  if (loaded) {
    setFlash(uiT('ui.flash.loaded_status', 'Состояние плагина загружено; список окон, зависимости и советы обновляются в фоне.'), 'success');
  }
  runBackgroundTask('refresh Memory Reader processes', () => (
    refreshMemoryProcessTargetsIfNeeded({
      reason: 'initialize',
      force: true,
      silent: true,
    })
  ));
  runBackgroundTask('refresh OCR window targets', () => (
    refreshOcrWindowTargetsIfNeeded({
      reason: 'initialize',
      force: true,
      silent: true,
    })
  ));
  runBackgroundTask('restore install states', () => Promise.all([
    restoreTextractorInstallState(),
    restoreRapidOcrModelsState(),
  ]));
  initTtsPipelineControls();
  initInspectorPanel();
  initModeSwitchObserver();
  startAutoRefresh();
}

document.getElementById('refreshBtn').addEventListener('click', async () => {
  await withButtonPending('refreshBtn', uiT('ui.pending.refreshing', 'Обновление...'), async () => {
    setFlash(uiT('ui.flash.refreshing_plugin_status', 'Обновление статуса плагина...'), 'info');
    const loaded = await refreshAll({ forceInsights: true, showInsightPending: true });
    if (loaded) {
      refreshMemoryProcessTargetsIfNeeded({
        reason: 'manual_refresh',
        force: true,
        silent: true,
      }).catch((error) => { console.error('[galgame] async action failed', error); });
      refreshCharacterProfiles({
        force: true,
        silent: true,
      }).catch((error) => { console.error('[galgame] async action failed', error); });
    }
    const windowsLoaded = loaded
      ? await refreshOcrWindowTargetsIfNeeded({
        reason: 'manual_refresh',
        force: true,
        silent: true,
      })
      : false;
    if (loaded) {
      setFlash(
        windowsLoaded
          ? uiT('ui.flash.status_windows_refreshed_insights_pending', 'Статус и список окон обновлены; подсказки выбора обновляются в фоне.')
          : uiT('ui.flash.status_refreshed_windows_failed', 'Статус обновлен; список окон обновить не удалось. Попробуйте позже.'),
        windowsLoaded ? 'success' : 'warning',
      );
    }
  });
});
document.getElementById('primaryDiagnosisPanel').addEventListener('click', (event) => {
  const target = eventElement(event.target);
  const button = target ? target.closest('[data-primary-action]') : null;
  if (!button) {
    return;
  }
  const action = button.getAttribute('data-primary-action') || '';
  withButtonPending(button, uiT('ui.pending.processing', 'Обработка...'), () => handleDiagnosisAction(action)).catch((error) => {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  });
});
document.getElementById('firstRunGuide').addEventListener('click', (event) => {
  const target = eventElement(event.target);
  const button = target ? target.closest('[data-first-run-action]') : null;
  if (!button) {
    return;
  }
  const action = button.getAttribute('data-first-run-action') || '';
  handleFirstRunActionClick(button, action).catch((error) => {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  });
});
document.getElementById('resetTutorialBtn')?.addEventListener('click', (event) => {
  const button = eventElement(event.currentTarget);
  if (!button) {
    return;
  }
  withButtonPending(button, uiT('ui.pending.processing', 'Обработка...'), () => handleDiagnosisAction('reset_tutorial')).catch((error) => {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  });
});
document.getElementById('saveModeBtn').addEventListener('click', () => {
  withButtonPending('saveModeBtn', uiT('ui.pending.saving', 'Сохранение...'), saveMode).catch((error) => { console.error('[galgame] async action failed', error); });
});
SETTINGS_CONTROL_IDS.forEach((id) => {
  const node = document.getElementById(id);
  if (!node) {
    return;
  }
  const markDirty = () => {
    if (!settingsSaveInFlight) {
      settingsDirty = true;
      updateSettingsDirtyHint();
      if (node.tagName === 'SELECT') {
        scheduleSettingsAutosave();
      }
    }
  };
  node.addEventListener('input', markDirty);
  node.addEventListener('change', markDirty);
});
document.getElementById('clearBindBtn').addEventListener('click', async () => {
  await withButtonPending('clearBindBtn', uiT('ui.pending.restoring', 'Восстановление...'), () => bindGame(''));
});
document.getElementById('standbyOnBtn').addEventListener('click', () => {
  withButtonPending('standbyOnBtn', uiT('ui.pending.switching', 'Переключение...'), () => setStandby(true)).catch((error) => { console.error('[galgame] async action failed', error); });
});
document.getElementById('standbyOffBtn').addEventListener('click', () => {
  withButtonPending('standbyOffBtn', uiT('ui.pending.processing', 'Обработка...'), resumeAgentFromButton).catch((error) => { console.error('[galgame] async action failed', error); });
});
document.querySelector('.agent-panel-tabs')?.addEventListener('click', (event) => {
  const target = eventElement(event.target);
  const tab = target ? target.closest('[data-agent-tab]') : null;
  if (!tab) {
    return;
  }
  const name = tab.getAttribute('data-agent-tab') || '';
  document.querySelectorAll('.agent-tab').forEach((item) => {
    const active = item === tab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('[data-agent-tab-panel]').forEach((panel) => {
    const active = panel.getAttribute('data-agent-tab-panel') === name;
    panel.hidden = !active;
    panel.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
});
document.querySelector('.plugin-settings-tabs')?.addEventListener('click', (event) => {
  const target = eventElement(event.target);
  const tab = target ? target.closest('[data-settings-tab]') : null;
  if (!tab) {
    return;
  }
  setPluginSettingsTab(tab.getAttribute('data-settings-tab') || 'recognition');
});
document.getElementById('queryContextBtn')?.addEventListener('click', () => {
  withButtonPending('queryContextBtn', uiT('ui.pending.querying', 'Запрос...'), () => askAgent('query_context')).catch((error) => { console.error('[galgame] async action failed', error); });
});
document.getElementById('sendMessageBtn')?.addEventListener('click', () => {
  withButtonPending('sendMessageBtn', uiT('ui.pending.sending', 'Отправка...'), () => askAgent('send_message')).catch((error) => { console.error('[galgame] async action failed', error); });
});
document.getElementById('characterProfileFixedBtn')?.addEventListener('click', () => {
  withButtonPending('characterProfileFixedBtn', uiT('ui.pending.saving', 'Сохранение...'), () => (
    setCharacterProfileMode('fixed')
  )).catch((error) => {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  });
});
document.getElementById('characterProfileOffBtn')?.addEventListener('click', () => {
  withButtonPending('characterProfileOffBtn', uiT('ui.pending.saving', 'Сохранение...'), () => (
    setCharacterProfileMode('off')
  )).catch((error) => {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  });
});
document.getElementById('characterProfileRefreshBtn')?.addEventListener('click', () => {
  refreshCharacterProfiles({
    force: true,
    silent: false,
  }).then((refreshed) => {
    if (refreshed) {
      setFlash(uiT('ui.flash.character_profiles_refreshed', 'Список профилей персонажей обновлен'), 'success');
    }
  }).catch((error) => {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  });
});
document.getElementById('characterProfileSelect')?.addEventListener('change', () => {
  renderCharacterProfilePanel(latestStatus);
});
document.getElementById('characterProfileSelect')?.addEventListener('focus', () => {
  if (shouldRefreshCharacterProfilesForStatus(latestStatus)) {
    refreshCharacterProfiles({ force: true, silent: true }).catch((error) => {
      console.warn('[galgame_plugin ui] character profile focus refresh failed', error);
    });
  }
});
document.getElementById('memoryProcessRefreshBtn').addEventListener('click', () => {
  refreshMemoryProcessTargetsIfNeeded({
    reason: 'memory_process_refresh_button',
    force: true,
    silent: false,
  }).then((refreshed) => {
    if (!refreshed) {
      setFlash(uiT('ui.flash.memory_process_refresh_failed', 'Не удалось обновить список процессов Memory Reader. Попробуйте позже.'), 'warning');
    }
  }).catch((error) => {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  });
});
document.getElementById('memoryProcessAutoBtn').addEventListener('click', () => {
  clearMemoryProcessTarget().catch((error) => { console.error('[galgame] async action failed', error); });
});
document.getElementById('memoryProcessSelectBtn').addEventListener('click', () => {
  openMemoryProcessModal().catch((error) => {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  });
});
document.getElementById('memoryProcessModalClose').addEventListener('click', closeMemoryProcessModal);
document.querySelector('#memoryProcessModal .modal-overlay').addEventListener('click', closeMemoryProcessModal);
document.getElementById('ocrWindowRefreshBtn').addEventListener('click', () => {
  refreshOcrWindowTargetsIfNeeded({
    reason: 'window_list_refresh_button',
    force: true,
    silent: false,
  }).then((refreshed) => {
    if (!refreshed) {
      setFlash(uiT('ui.flash.ocr_window_refresh_failed', 'Не удалось обновить список окон OCR. Попробуйте позже.'), 'warning');
    }
  }).catch((error) => {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  });
});
document.getElementById('ocrWindowAutoBtn').addEventListener('click', () => {
  clearOcrWindowTargetWithFeedback().catch((error) => { console.error('[galgame] async action failed', error); });
});
document.getElementById('ocrWindowSelectBtn').addEventListener('click', () => {
  openOcrWindowModal().catch((error) => {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  });
});
document.getElementById('ocrWindowModalClose').addEventListener('click', closeOcrWindowModal);
document.querySelector('#ocrWindowModal .modal-overlay').addEventListener('click', closeOcrWindowModal);
document.addEventListener('pointerdown', (event) => {
  if (!document.body.classList.contains('panel-fullscreen-active')) {
    return;
  }
  const panel = document.querySelector('.panel-fullscreen');
  const target = eventElement(event.target);
  if (panel && target && !panel.contains(target)) {
    exitPanelFullscreen();
  }
});
document.addEventListener('wheel', (event) => {
  if (!document.body.classList.contains('panel-fullscreen-active') || event.ctrlKey) {
    return;
  }
  const target = fullscreenWheelTarget(event.target, event.deltaY);
  if (!target) {
    return;
  }
  target.scrollTop += event.deltaY;
  event.preventDefault();
}, { passive: false });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    exitPanelFullscreen();
    closeMemoryProcessModal();
    closeOcrWindowModal();
  }
});
document.getElementById('ocrProfileSaveBtn').addEventListener('click', saveOcrCaptureProfile);
document.getElementById('ocrProfileClearBtn').addEventListener('click', clearOcrCaptureProfile);
document.getElementById('ocrProfileAutoRecalibrateBtn').addEventListener('click', autoRecalibrateOcrDialogueProfile);
document.getElementById('ocrProfileApplyRecommendedBtn').addEventListener('click', applyRecommendedOcrCaptureProfile);
document.getElementById('ocrProfileRollbackBtn').addEventListener('click', rollbackOcrCaptureProfileRecommendation);
document.getElementById('ocrProfileGamePresetSelect').addEventListener('change', selectOcrGameCapturePreset);
document.getElementById('ocrProfileStageSelect').addEventListener('change', () => {
  if (latestStatus) {
    renderOcrProfile(latestStatus);
  }
});
document.getElementById('ocrProfileSaveScopeSelect').addEventListener('change', () => {
  if (latestStatus) {
    renderOcrProfile(latestStatus);
  }
});
document.getElementById('ocrProfileProcessInput').addEventListener('blur', () => {
  if (latestStatus) {
    renderOcrProfile(latestStatus);
  }
});

document.querySelectorAll('#modeSwitch .mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const modeSwitchEl = document.getElementById('modeSwitch');
    if (!modeSwitchEl || modeSwitchEl.dataset.ready !== 'true') {
      return;
    }
    const mode = btn.dataset.mode;
    const select = document.getElementById('modeSelect');
    if (select && mode) {
      select.value = mode;
      select.dispatchEvent(new Event('change'));
      pendingModeSelection = mode;
      updateModeSwitchControl(mode);
      updateSummaryMode(mode);
      saveMode().catch((error) => { console.error('[galgame] async action failed', error); });
    }
  });
});

document.querySelectorAll('#speedSwitch .speed-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const speed = btn.dataset.speed;
    const select = document.getElementById('advanceSpeedSelect');
    if (select && speed) {
      select.value = speed;
      select.dispatchEvent(new Event('change'));
      saveMode().catch((error) => { console.error('[galgame] async action failed', error); });
    }
  });
});

document.querySelectorAll('[data-skip-onboarding]').forEach((btn) => {
  btn.addEventListener('click', () => {
    persistSkipOnboarding();
    onboardingDismissed = true;
    forceShowOnboarding = false;
    document.body.classList.remove('onboarding-active');
    const onboardingView = document.getElementById('onboardingView');
    if (onboardingView) {
      onboardingView.hidden = true;
    }
    saveTutorialProgress({ skipped: true, last_step_index: 0 }).catch(() => {});
  });
});

document.getElementById('onboardingView').addEventListener('click', (event) => {
  const target = eventElement(event.target);
  const button = target ? target.closest('[data-first-run-action]') : null;
  if (!button) {
    return;
  }
  const action = button.getAttribute('data-first-run-action') || '';
  handleFirstRunActionClick(button, action).catch((error) => {
    setFlash(error instanceof Error ? error.message : String(error), 'error');
  });
});

const advancedToggleBtn = document.getElementById('advancedToggleBtn');
if (advancedToggleBtn) {
  advancedToggleBtn.addEventListener('click', () => {
    const el = document.getElementById('advancedSettings');
    if (el) {
      el.classList.toggle('open');
      advancedToggleBtn.textContent = el.classList.contains('open')
        ? uiT('ui.advanced.collapse_settings', 'Свернуть расширенные настройки')
        : uiT('ui.advanced.settings', 'Расширенные настройки');
      if (el.classList.contains('open')) {
        const firstRunGuide = document.getElementById('firstRunGuide');
        if (firstRunGuide) {
          firstRunGuide.hidden = true;
        }
      }
    }
  });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshAll({ preserveFlash: true, silent: true }).catch((error) => { console.error('[galgame] async action failed', error); });
    refreshMemoryProcessTargetsIfNeeded({ reason: 'page_focus', silent: true }).catch((error) => { console.error('[galgame] async action failed', error); });
    refreshOcrWindowsOnPageFocus();
  }
});

window.addEventListener('focus', () => {
  refreshAll({ preserveFlash: true, silent: true }).catch((error) => { console.error('[galgame] async action failed', error); });
  refreshMemoryProcessTargetsIfNeeded({ reason: 'page_focus', silent: true }).catch((error) => { console.error('[galgame] async action failed', error); });
  refreshOcrWindowsOnPageFocus();
});

window.addEventListener('i18n-ready', () => {
  syncPluginStatusSectionLabels();
  syncPluginStatusHubSummaryLabels();
  if (window.I18n && typeof window.I18n.lang === 'function' && window.I18n.lang() !== 'zh-CN') {
    refreshAll({ preserveFlash: true, silent: true }).catch((error) => { console.error('[galgame] async action failed', error); });
  }
});

window.addEventListener('i18n-lang-changed', () => {
  syncPluginStatusSectionLabels();
  syncPluginStatusHubSummaryLabels();
});

initialize();
