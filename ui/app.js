const elements = {
  form: document.querySelector('#config-form'),
  guided: document.querySelector('#guided-fields'),
  notice: document.querySelector('#notice'),
  saveTop: document.querySelector('#save-button'),
  saveFooter: document.querySelector('#footer-save-button'),
  validate: document.querySelector('#validate-button'),
  browseModels: document.querySelector('#browse-models'),
  closeLibrary: document.querySelector('#close-library'),
  modelLibrary: document.querySelector('#model-library'),
  modelSearch: document.querySelector('#model-search'),
  modelSizeFilter: document.querySelector('#model-size-filter'),
  modelFilters: document.querySelector('#model-filters'),
  libraryResultSummary: document.querySelector('#library-result-summary'),
  libraryResults: document.querySelector('#library-results'),
  libraryMore: document.querySelector('#library-more'),
  librarySelectionLabel: document.querySelector('#library-selection-label'),
  addSelectedModels: document.querySelector('#add-selected-models'),
  addModel: document.querySelector('#add-model'),
  modelList: document.querySelector('#model-list'),
  modelCount: document.querySelector('#model-count'),
  rawJson: document.querySelector('#raw-json'),
  editJson: document.querySelector('#edit-json'),
  jsonToolbar: document.querySelector('#json-toolbar'),
  applyJson: document.querySelector('#apply-json'),
  cancelJson: document.querySelector('#cancel-json'),
  changeState: document.querySelector('#change-state'),
  changeLabel: document.querySelector('#change-label'),
  runtimeState: document.querySelector('#runtime-state'),
  runtimeLabel: document.querySelector('#runtime-label'),
  workerValue: document.querySelector('#worker-value'),
  sourceValue: document.querySelector('#source-value'),
  authValue: document.querySelector('#auth-value'),
  versionValue: document.querySelector('#version-value'),
  refreshStatus: document.querySelector('#refresh-status'),
  backupList: document.querySelector('#backup-list'),
  resetButton: document.querySelector('#reset-button'),
  resetConfirmation: document.querySelector('#reset-confirmation'),
  confirmReset: document.querySelector('#confirm-reset'),
  cancelReset: document.querySelector('#cancel-reset'),
  importFile: document.querySelector('#import-file'),
  docsLink: document.querySelector('#docs-link'),
  loggerLevel: document.querySelector('#logger-level'),
  loggerConsole: document.querySelector('#logger-console'),
  cacheDirectory: document.querySelector('#cache-directory'),
  downloadConcurrency: document.querySelector('#download-concurrency'),
  connectionTimeout: document.querySelector('#connection-timeout'),
  registryRetries: document.querySelector('#registry-retries'),
  registryTimeout: document.querySelector('#registry-timeout'),
  corsOrigins: document.querySelector('#cors-origins'),
  publicBaseUrl: document.querySelector('#public-base-url')
}

const defaults = {
  loggerLevel: 'info',
  loggerConsoleOutput: true,
  cacheDirectory: '/data/models',
  httpDownloadConcurrency: 3,
  httpConnectionTimeoutMs: 10000,
  registryDownloadMaxRetries: 3,
  registryStreamTimeoutMs: 60000
}

const STATUS_REFRESH_INTERVAL_MS = 30_000

const modelTypes = [
  ['llm', 'Text generation'],
  ['embeddings', 'Embeddings'],
  ['whisper', 'Whisper transcription'],
  ['parakeet', 'Parakeet transcription'],
  ['nmt', 'Translation'],
  ['tts', 'Text to speech'],
  ['ocr', 'OCR'],
  ['whispercpp-audio-translation', 'Audio translation'],
  ['diffusion', 'Image generation']
]

let config = null
let dirty = false
let jsonEditing = false
let syncTimer = null
let noticeTimer = null
let statusRefreshTimer = null
let catalog = []
let catalogLoadPromise = null
let catalogFilter = 'all'
let catalogVisibleLimit = 50
const selectedCatalogModels = new Set()

function clone(value) {
  return structuredClone(value)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function setBusy(button, busy, busyLabel) {
  if (!button.dataset.label) button.dataset.label = button.textContent.trim()
  button.disabled = busy
  button.textContent = busy ? busyLabel : button.dataset.label
}

function setNotice(message, tone = 'neutral', persist = false) {
  clearTimeout(noticeTimer)
  elements.notice.textContent = message
  elements.notice.dataset.tone = tone
  elements.notice.hidden = false
  if (!persist) {
    noticeTimer = setTimeout(() => {
      elements.notice.hidden = true
    }, 7000)
  }
}

function clearNotice() {
  clearTimeout(noticeTimer)
  elements.notice.hidden = true
}

function setDirty(nextDirty) {
  dirty = nextDirty
  elements.changeState.dataset.dirty = String(dirty)
  elements.changeLabel.textContent = dirty ? 'Unsaved changes' : 'No unsaved changes'
  elements.saveTop.disabled = !dirty || jsonEditing
  elements.saveFooter.disabled = !dirty || jsonEditing
}

function numberValue(element, fallback) {
  const value = Number.parseInt(element.value, 10)
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function formatDate(value) {
  if (!value) return 'Unknown time'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

async function request(url, options = {}) {
  const response = await fetch(url, options)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const details = Array.isArray(payload.details) && payload.details.length
      ? ` ${payload.details.join(' ')}`
      : ''
    throw new Error(`${payload.error || `Request failed (${response.status}).`}${details}`)
  }
  return payload
}

function writeHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-QVAC-UI': '1'
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Size unknown'
  const gibibyte = 1024 ** 3
  if (bytes < gibibyte) return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
  const value = bytes / gibibyte
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} GB`
}

function configuredModelConstants() {
  return new Set(
    [...elements.modelList.querySelectorAll('.model-editor')]
      .filter((editor) => editor.querySelector('[data-model-field="source-kind"]').value === 'constant')
      .map((editor) => editor.querySelector('[data-model-field="source"]').value.trim())
      .filter(Boolean)
  )
}

function updateLibrarySelection() {
  const count = selectedCatalogModels.size
  elements.librarySelectionLabel.textContent = count === 0
    ? 'No models selected'
    : `${count} model${count === 1 ? '' : 's'} selected`
  elements.addSelectedModels.disabled = count === 0
  elements.addSelectedModels.textContent = count === 0
    ? 'Add selected'
    : `Add selected (${count})`
}

function createCatalogRow(model, configured) {
  const row = document.createElement('label')
  row.className = 'library-model-row'
  row.dataset.configured = String(configured)

  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.checked = selectedCatalogModels.has(model.name)
  checkbox.disabled = configured
  checkbox.setAttribute('aria-label', configured
    ? `${model.title} is already configured`
    : `Select ${model.title}`)
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selectedCatalogModels.add(model.name)
    else selectedCatalogModels.delete(model.name)
    updateLibrarySelection()
  })

  const copy = document.createElement('div')
  copy.className = 'library-model-copy'
  const titleLine = document.createElement('div')
  titleLine.className = 'library-model-title-line'
  const title = document.createElement('span')
  title.className = 'library-model-title'
  title.textContent = model.title
  titleLine.append(title)
  if (model.recommended) {
    const recommended = document.createElement('span')
    recommended.className = 'library-model-recommended'
    recommended.textContent = 'Recommended'
    titleLine.append(recommended)
  }
  const description = document.createElement('p')
  description.className = 'library-model-description'
  description.textContent = model.description
  const constant = document.createElement('code')
  constant.className = 'library-model-constant'
  constant.textContent = model.name
  constant.title = model.name
  copy.append(titleLine, description, constant)

  const meta = document.createElement('div')
  meta.className = 'library-model-meta'
  const labels = [
    configured ? 'Configured' : model.capabilityLabel,
    model.params,
    model.quantization ? model.quantization.toUpperCase() : '',
    formatBytes(model.downloadSize)
  ].filter(Boolean)
  labels.forEach((label, index) => {
    const item = document.createElement('span')
    item.textContent = label
    if (index === labels.length - 1) item.classList.add(`resource-${model.resourceTier}`)
    meta.append(item)
  })

  row.append(checkbox, copy, meta)
  return row
}

function filteredCatalog() {
  const query = elements.modelSearch.value.trim().toLowerCase()
  const size = elements.modelSizeFilter.value
  return catalog.filter((model) => {
    const matchesCapability = catalogFilter === 'all'
      || (catalogFilter === 'recommended' ? model.recommended : model.capability === catalogFilter)
    const matchesSize = size === 'all' || model.resourceTier === size
    const haystack = `${model.title} ${model.name} ${model.description} ${model.capabilityLabel} ${model.params} ${model.quantization}`.toLowerCase()
    return matchesCapability && matchesSize && (!query || haystack.includes(query))
  })
}

function renderModelLibrary() {
  if (catalog.length === 0) return
  const matches = filteredCatalog()
  const visible = matches.slice(0, catalogVisibleLimit)
  const configured = configuredModelConstants()
  for (const name of configured) selectedCatalogModels.delete(name)

  elements.libraryResults.replaceChildren()
  elements.libraryResults.setAttribute('aria-busy', 'false')
  if (visible.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'library-empty'
    empty.textContent = 'No models match these filters.'
    elements.libraryResults.append(empty)
  } else {
    for (const model of visible) {
      elements.libraryResults.append(createCatalogRow(model, configured.has(model.name)))
    }
  }

  elements.libraryResultSummary.textContent = visible.length === matches.length
    ? `${matches.length} model${matches.length === 1 ? '' : 's'}`
    : `Showing ${visible.length} of ${matches.length} models`
  elements.libraryMore.hidden = visible.length >= matches.length
  updateLibrarySelection()
}

async function loadModelCatalog() {
  if (catalog.length > 0) return catalog
  if (!catalogLoadPromise) {
    catalogLoadPromise = request('/api/models/catalog')
      .then((payload) => {
        catalog = Array.isArray(payload.models) ? payload.models : []
        renderModelLibrary()
        return catalog
      })
      .catch((error) => {
        catalogLoadPromise = null
        elements.libraryResults.replaceChildren()
        elements.libraryResults.setAttribute('aria-busy', 'false')
        const message = document.createElement('p')
        message.className = 'library-empty'
        message.textContent = 'The installed QVAC model catalogue could not be loaded.'
        elements.libraryResults.append(message)
        elements.libraryResultSummary.textContent = 'Catalogue unavailable'
        setNotice(error.message, 'error', true)
        return []
      })
  }
  return catalogLoadPromise
}

async function toggleModelLibrary(open) {
  elements.modelLibrary.hidden = !open
  elements.browseModels.setAttribute('aria-expanded', String(open))
  elements.browseModels.textContent = open ? 'Hide library' : 'Browse library'
  if (!open) return
  await loadModelCatalog()
  elements.modelSearch.focus()
}

function uniqueModelAlias(preferred, existing) {
  const base = (preferred || 'model').slice(0, 64)
  if (!existing.has(base)) return base
  let suffix = 2
  while (existing.has(`${base.slice(0, 61 - String(suffix).length)}-${suffix}`)) suffix += 1
  return `${base.slice(0, 61 - String(suffix).length)}-${suffix}`
}

function addSelectedCatalogModels() {
  const choices = catalog.filter((model) => selectedCatalogModels.has(model.name))
  if (choices.length === 0) return

  const existingAliases = new Set(
    [...elements.modelList.querySelectorAll('[data-model-field="alias"]')]
      .map((input) => input.value.trim())
      .filter(Boolean)
  )
  const existingCount = elements.modelList.querySelectorAll('.model-editor').length
  let index = existingCount

  for (const model of choices) {
    const alias = uniqueModelAlias(model.alias, existingAliases)
    existingAliases.add(alias)
    elements.modelList.append(createModelEditor(alias, {
      model: model.name,
      default: index === 0,
      preload: index === 0,
      config: isObject(model.config) ? model.config : {}
    }, index))
    index += 1
  }

  selectedCatalogModels.clear()
  renumberModels()
  renderModelLibrary()
  markFormChanged()
  setNotice(`${choices.length} model${choices.length === 1 ? '' : 's'} added. Review preload and default settings before saving.`, 'success')
}

function createModelEditor(alias, value, index) {
  const entry = typeof value === 'string' ? { model: value, preload: true } : clone(value)
  const explicit = typeof entry.src === 'string' && entry.src !== ''
  const editor = document.createElement('article')
  editor.className = 'model-editor'
  editor.dataset.modelIndex = String(index)
  editor._originalEntry = isObject(entry) ? clone(entry) : {}
  editor.innerHTML = `
    <header class="model-editor-header">
      <span class="model-index">${String(index + 1).padStart(2, '0')}</span>
      <strong class="model-title">Model ${index + 1}</strong>
      <button class="remove-model" type="button">Remove</button>
    </header>
    <div class="model-fields">
      <label>
        <span>API alias</span>
        <input data-model-field="alias" type="text" autocomplete="off" spellcheck="false" required>
      </label>
      <label>
        <span>Source</span>
        <select data-model-field="source-kind">
          <option value="constant">QVAC registry constant</option>
          <option value="explicit">URL or local path</option>
        </select>
      </label>
      <label class="model-source-field">
        <span data-source-label>QVAC model constant</span>
        <input data-model-field="source" type="text" autocomplete="off" spellcheck="false" required>
      </label>
      <label data-type-field hidden>
        <span>Model type</span>
        <select data-model-field="type"></select>
      </label>
      <div class="model-toggles">
        <label class="model-toggle">
          <input data-model-field="default" type="checkbox">
          <span>Default for its endpoint</span>
        </label>
        <label class="model-toggle">
          <input data-model-field="preload" type="checkbox">
          <span>Load when QVAC starts</span>
        </label>
      </div>
      <label class="model-config-field">
        <span>Engine configuration (JSON object)</span>
        <textarea data-model-field="config" rows="4" spellcheck="false" placeholder="{}"></textarea>
      </label>
    </div>
  `

  const aliasInput = editor.querySelector('[data-model-field="alias"]')
  const sourceKind = editor.querySelector('[data-model-field="source-kind"]')
  const sourceInput = editor.querySelector('[data-model-field="source"]')
  const typeSelect = editor.querySelector('[data-model-field="type"]')
  const defaultInput = editor.querySelector('[data-model-field="default"]')
  const preloadInput = editor.querySelector('[data-model-field="preload"]')
  const configInput = editor.querySelector('[data-model-field="config"]')

  for (const [value, label] of modelTypes) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    typeSelect.append(option)
  }

  aliasInput.value = alias
  sourceKind.value = explicit ? 'explicit' : 'constant'
  sourceInput.value = explicit ? entry.src : (entry.model ?? '')
  typeSelect.value = entry.type ?? 'llm'
  defaultInput.checked = entry.default ?? false
  preloadInput.checked = entry.preload ?? !explicit
  configInput.value = JSON.stringify(isObject(entry.config) ? entry.config : {}, null, 2)

  function syncSourceMode() {
    const isExplicit = sourceKind.value === 'explicit'
    editor.querySelector('[data-source-label]').textContent = isExplicit
      ? 'Model URL or absolute path'
      : 'QVAC model constant'
    editor.querySelector('[data-type-field]').hidden = !isExplicit
    sourceInput.placeholder = isExplicit
      ? 'https://… or /data/models/model.gguf'
      : 'QWEN3_600M_INST_Q4'
  }

  sourceKind.addEventListener('change', syncSourceMode)
  editor.querySelector('.remove-model').addEventListener('click', () => {
    editor.remove()
    renumberModels()
    renderModelLibrary()
    markFormChanged()
  })
  aliasInput.addEventListener('input', () => {
    editor.querySelector('.model-title').textContent = aliasInput.value.trim() || `Model ${index + 1}`
  })
  syncSourceMode()
  return editor
}

function renumberModels() {
  const editors = [...elements.modelList.querySelectorAll('.model-editor')]
  editors.forEach((editor, index) => {
    editor.dataset.modelIndex = String(index)
    editor.querySelector('.model-index').textContent = String(index + 1).padStart(2, '0')
    const alias = editor.querySelector('[data-model-field="alias"]').value.trim()
    editor.querySelector('.model-title').textContent = alias || `Model ${index + 1}`
  })
  elements.modelCount.textContent = String(editors.length)
  const empty = elements.modelList.querySelector('.model-empty')
  if (editors.length === 0 && !empty) {
    const message = document.createElement('p')
    message.className = 'model-empty'
    message.textContent = 'Add at least one model before saving.'
    elements.modelList.append(message)
  } else if (editors.length > 0 && empty) {
    empty.remove()
  }
}

function renderModels(models) {
  elements.modelList.replaceChildren()
  Object.entries(models ?? {}).forEach(([alias, entry], index) => {
    elements.modelList.append(createModelEditor(alias, entry, index))
  })
  renumberModels()
  renderModelLibrary()
}

function renderConfig(nextConfig) {
  config = clone(nextConfig)
  const serve = isObject(config.serve) ? config.serve : {}
  const cors = isObject(serve.cors) ? serve.cors : {}

  elements.loggerLevel.value = config.loggerLevel ?? defaults.loggerLevel
  elements.loggerConsole.checked = config.loggerConsoleOutput ?? defaults.loggerConsoleOutput
  elements.cacheDirectory.value = config.cacheDirectory ?? defaults.cacheDirectory
  elements.downloadConcurrency.value = config.httpDownloadConcurrency ?? defaults.httpDownloadConcurrency
  elements.connectionTimeout.value = config.httpConnectionTimeoutMs ?? defaults.httpConnectionTimeoutMs
  elements.registryRetries.value = config.registryDownloadMaxRetries ?? defaults.registryDownloadMaxRetries
  elements.registryTimeout.value = config.registryStreamTimeoutMs ?? defaults.registryStreamTimeoutMs
  elements.corsOrigins.value = Array.isArray(cors.origins) ? cors.origins.join('\n') : ''
  elements.publicBaseUrl.value = serve.publicBaseUrl ?? ''
  renderModels(serve.models)
  elements.rawJson.value = `${JSON.stringify(config, null, 2)}\n`
}

function collectConfig() {
  if (!config) throw new Error('Configuration has not loaded yet.')
  const next = clone(config)
  next.loggerLevel = elements.loggerLevel.value
  next.loggerConsoleOutput = elements.loggerConsole.checked
  next.cacheDirectory = elements.cacheDirectory.value.trim()
  next.httpDownloadConcurrency = numberValue(elements.downloadConcurrency, defaults.httpDownloadConcurrency)
  next.httpConnectionTimeoutMs = numberValue(elements.connectionTimeout, defaults.httpConnectionTimeoutMs)
  next.registryDownloadMaxRetries = numberValue(elements.registryRetries, defaults.registryDownloadMaxRetries)
  next.registryStreamTimeoutMs = numberValue(elements.registryTimeout, defaults.registryStreamTimeoutMs)
  next.serve = isObject(next.serve) ? next.serve : {}

  const origins = elements.corsOrigins.value
    .split('\n')
    .map((origin) => origin.trim())
    .filter(Boolean)
  next.serve.cors = isObject(next.serve.cors) ? next.serve.cors : {}
  next.serve.cors.origins = origins

  const publicBaseUrl = elements.publicBaseUrl.value.trim()
  if (publicBaseUrl) next.serve.publicBaseUrl = publicBaseUrl
  else delete next.serve.publicBaseUrl

  const models = {}
  for (const editor of elements.modelList.querySelectorAll('.model-editor')) {
    const alias = editor.querySelector('[data-model-field="alias"]').value.trim()
    if (!alias) throw new Error('Every model needs an API alias.')
    if (Object.hasOwn(models, alias)) throw new Error(`Model alias "${alias}" is used more than once.`)

    const sourceKind = editor.querySelector('[data-model-field="source-kind"]').value
    const source = editor.querySelector('[data-model-field="source"]').value.trim()
    if (!source) throw new Error(`Model "${alias}" needs a source.`)

    let modelConfig
    try {
      modelConfig = JSON.parse(editor.querySelector('[data-model-field="config"]').value || '{}')
    } catch {
      throw new Error(`Model "${alias}" has invalid engine configuration JSON.`)
    }
    if (!isObject(modelConfig)) throw new Error(`Model "${alias}" engine configuration must be an object.`)

    const entry = isObject(editor._originalEntry) ? clone(editor._originalEntry) : {}
    delete entry.model
    delete entry.src
    delete entry.type
    if (sourceKind === 'constant') entry.model = source
    else {
      entry.src = source
      entry.type = editor.querySelector('[data-model-field="type"]').value
    }
    entry.default = editor.querySelector('[data-model-field="default"]').checked
    entry.preload = editor.querySelector('[data-model-field="preload"]').checked
    entry.config = modelConfig
    models[alias] = entry
  }

  next.serve.models = models
  return next
}

function syncJsonPreview() {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    if (jsonEditing) return
    try {
      elements.rawJson.value = `${JSON.stringify(collectConfig(), null, 2)}\n`
    } catch {
      // Keep the last valid preview while a field is incomplete.
    }
  }, 180)
}

function markFormChanged() {
  setDirty(true)
  syncJsonPreview()
}

function renderBackups(backups) {
  elements.backupList.replaceChildren()
  if (!Array.isArray(backups) || backups.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'muted'
    empty.textContent = 'Backups appear after your second save.'
    elements.backupList.append(empty)
    return
  }

  for (const backup of backups.slice(0, 4)) {
    const row = document.createElement('div')
    row.className = 'backup-item'
    const label = document.createElement('span')
    label.textContent = formatDate(backup.savedAt)
    label.title = backup.name
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Restore'
    button.dataset.backupName = backup.name
    button.addEventListener('click', () => restoreBackup(button, backup.name))
    row.append(label, button)
    elements.backupList.append(row)
  }
}

async function restoreBackup(button, name) {
  if (button.dataset.confirm !== 'true') {
    button.dataset.confirm = 'true'
    button.textContent = 'Confirm'
    setTimeout(() => {
      if (button.isConnected) {
        delete button.dataset.confirm
        button.textContent = 'Restore'
      }
    }, 4500)
    return
  }

  setBusy(button, true, 'Restoring…')
  try {
    const payload = await request('/api/backups/restore', {
      method: 'POST',
      headers: writeHeaders(),
      body: JSON.stringify({ name })
    })
    renderConfig(payload.config)
    setDirty(false)
    await refreshConfigMetadata()
    await refreshStatus()
    setNotice('Backup restored. The QVAC worker is reloading.', 'success')
  } catch (error) {
    setNotice(error.message, 'error', true)
  } finally {
    setBusy(button, false, '')
    delete button.dataset.confirm
    button.textContent = 'Restore'
  }
}

async function loadConfig() {
  try {
    const payload = await request('/api/config')
    renderConfig(payload.config)
    renderBackups(payload.backups)
    elements.sourceValue.textContent = payload.source
    elements.guided.disabled = false
    setDirty(false)
    elements.validate.disabled = false
    clearNotice()
  } catch (error) {
    setNotice(`Configuration could not be loaded. ${error.message}`, 'error', true)
  }
}

async function refreshConfigMetadata() {
  const payload = await request('/api/config')
  renderBackups(payload.backups)
  elements.sourceValue.textContent = payload.source
}

function runtimeLabel(state) {
  return {
    online: 'Online',
    loading: 'Loading models',
    restarting: 'Restarting',
    error: 'Worker error',
    stopping: 'Stopping'
  }[state] ?? 'Offline'
}

async function refreshStatus() {
  try {
    const payload = await request('/api/status')
    const state = payload.state ?? 'offline'
    const label = runtimeLabel(state)
    elements.runtimeState.dataset.state = state
    elements.runtimeLabel.textContent = label
    elements.workerValue.textContent = state === 'online'
      ? `${payload.models.length} model${payload.models.length === 1 ? '' : 's'} ready`
      : label
    elements.sourceValue.textContent = payload.configSource ?? '—'
    elements.authValue.textContent = payload.authenticated ? 'Bearer token' : 'DAppNode network'
    elements.versionValue.textContent = payload.qvacVersion ?? '—'
  } catch {
    elements.runtimeState.dataset.state = 'offline'
    elements.runtimeLabel.textContent = 'Manager offline'
    elements.workerValue.textContent = 'Unavailable'
  }
}

function scheduleStatusRefresh() {
  clearInterval(statusRefreshTimer)
  statusRefreshTimer = null
  if (document.visibilityState !== 'visible') return
  statusRefreshTimer = setInterval(refreshStatus, STATUS_REFRESH_INTERVAL_MS)
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') refreshStatus()
  scheduleStatusRefresh()
}

async function validate(nextConfig = null, announce = true) {
  const candidate = nextConfig ?? collectConfig()
  await request('/api/validate', {
    method: 'POST',
    headers: writeHeaders(),
    body: JSON.stringify({ config: candidate })
  })
  if (announce) setNotice('Configuration is valid and ready to save.', 'success')
  return candidate
}

async function saveConfig() {
  clearNotice()
  let candidate
  try {
    candidate = await validate(null, false)
  } catch (error) {
    setNotice(error.message, 'error', true)
    return
  }

  setBusy(elements.saveTop, true, 'Saving…')
  setBusy(elements.saveFooter, true, 'Saving…')
  elements.validate.disabled = true

  try {
    await request('/api/config', {
      method: 'PUT',
      headers: writeHeaders(),
      body: JSON.stringify({ config: candidate })
    })
    config = clone(candidate)
    elements.rawJson.value = `${JSON.stringify(config, null, 2)}\n`
    setDirty(false)
    await refreshConfigMetadata()
    await refreshStatus()
    setNotice('Saved. The QVAC worker is reloading with this configuration.', 'success')
  } catch (error) {
    setNotice(error.message, 'error', true)
    setDirty(true)
  } finally {
    setBusy(elements.saveTop, false, '')
    setBusy(elements.saveFooter, false, '')
    elements.validate.disabled = false
    setDirty(dirty)
  }
}

function startJsonEditing() {
  try {
    elements.rawJson.value = `${JSON.stringify(collectConfig(), null, 2)}\n`
  } catch (error) {
    setNotice(error.message, 'error', true)
    return
  }
  jsonEditing = true
  elements.guided.disabled = true
  elements.rawJson.readOnly = false
  elements.editJson.hidden = true
  elements.jsonToolbar.hidden = false
  setDirty(dirty)
  elements.rawJson.focus()
}

function stopJsonEditing() {
  jsonEditing = false
  elements.guided.disabled = false
  elements.rawJson.readOnly = true
  elements.editJson.hidden = false
  elements.jsonToolbar.hidden = true
  setDirty(dirty)
}

async function applyJsonToForm() {
  let parsed
  try {
    parsed = JSON.parse(elements.rawJson.value)
    await validate(parsed, false)
  } catch (error) {
    setNotice(`JSON was not applied. ${error.message}`, 'error', true)
    return
  }
  renderConfig(parsed)
  setDirty(true)
  stopJsonEditing()
  setNotice('JSON applied to the guided controls. Save to reload QVAC.', 'success')
}

async function importJson(file) {
  try {
    const parsed = JSON.parse(await file.text())
    await validate(parsed, false)
    renderConfig(parsed)
    setDirty(true)
    setNotice(`${file.name} imported. Review the settings, then save to reload QVAC.`, 'success')
  } catch (error) {
    setNotice(`The file was not imported. ${error.message}`, 'error', true)
  } finally {
    elements.importFile.value = ''
  }
}

function addModel() {
  const index = elements.modelList.querySelectorAll('.model-editor').length
  const existing = new Set(
    [...elements.modelList.querySelectorAll('[data-model-field="alias"]')]
      .map((input) => input.value.trim())
  )
  let suffix = index + 1
  while (existing.has(`model-${suffix}`)) suffix += 1
  elements.modelList.append(
    createModelEditor(`model-${suffix}`, {
      model: 'QWEN3_600M_INST_Q4',
      default: false,
      preload: false,
      config: {}
    }, index)
  )
  renumberModels()
  renderModelLibrary()
  markFormChanged()
  const newEditor = elements.modelList.querySelector(`[data-model-index="${index}"]`)
  newEditor.querySelector('[data-model-field="alias"]').focus()
}

async function resetDefaults() {
  setBusy(elements.confirmReset, true, 'Restoring…')
  try {
    const payload = await request('/api/reset', {
      method: 'POST',
      headers: writeHeaders(),
      body: '{}'
    })
    renderConfig(payload.config)
    setDirty(false)
    elements.resetConfirmation.hidden = true
    elements.resetButton.hidden = false
    await refreshConfigMetadata()
    await refreshStatus()
    setNotice('Generated defaults restored. The QVAC worker is reloading.', 'success')
  } catch (error) {
    setNotice(error.message, 'error', true)
  } finally {
    setBusy(elements.confirmReset, false, '')
  }
}

function configureApiLinks() {
  const docsUrl = new URL(window.location.href)
  docsUrl.port = '11434'
  docsUrl.pathname = '/docs'
  docsUrl.search = ''
  docsUrl.hash = ''
  elements.docsLink.href = docsUrl.href
}

function configureNavigation() {
  const links = [...document.querySelectorAll('.section-nav a')]
  const targets = links
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean)
  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
    if (!visible) return
    for (const link of links) {
      if (link.getAttribute('href') === `#${visible.target.id}`) link.setAttribute('aria-current', 'true')
      else link.removeAttribute('aria-current')
    }
  }, { rootMargin: '-15% 0px -70% 0px', threshold: [0, 0.2, 0.6] })
  targets.forEach((target) => observer.observe(target))
}

elements.form.addEventListener('input', (event) => {
  if (event.target === elements.rawJson || event.target.closest('#model-library') || !config || jsonEditing) return
  markFormChanged()
})
elements.form.addEventListener('change', (event) => {
  if (event.target === elements.rawJson || event.target.closest('#model-library') || !config || jsonEditing) return
  markFormChanged()
})
elements.form.addEventListener('submit', (event) => {
  event.preventDefault()
  saveConfig()
})
elements.saveTop.addEventListener('click', saveConfig)
elements.validate.addEventListener('click', async () => {
  setBusy(elements.validate, true, 'Validating…')
  try {
    await validate()
  } catch (error) {
    setNotice(error.message, 'error', true)
  } finally {
    setBusy(elements.validate, false, '')
  }
})
elements.browseModels.addEventListener('click', () => toggleModelLibrary(elements.modelLibrary.hidden))
elements.closeLibrary.addEventListener('click', () => {
  toggleModelLibrary(false)
  elements.browseModels.focus()
})
elements.modelSearch.addEventListener('input', () => {
  catalogVisibleLimit = 50
  renderModelLibrary()
})
elements.modelSizeFilter.addEventListener('change', () => {
  catalogVisibleLimit = 50
  renderModelLibrary()
})
elements.modelFilters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-library-filter]')
  if (!button) return
  catalogFilter = button.dataset.libraryFilter
  for (const filterButton of elements.modelFilters.querySelectorAll('[data-library-filter]')) {
    filterButton.setAttribute('aria-pressed', String(filterButton === button))
  }
  catalogVisibleLimit = 50
  renderModelLibrary()
})
elements.libraryMore.addEventListener('click', () => {
  catalogVisibleLimit += 50
  renderModelLibrary()
})
elements.addSelectedModels.addEventListener('click', addSelectedCatalogModels)
elements.addModel.addEventListener('click', addModel)
elements.editJson.addEventListener('click', startJsonEditing)
elements.applyJson.addEventListener('click', applyJsonToForm)
elements.cancelJson.addEventListener('click', () => {
  elements.rawJson.value = `${JSON.stringify(collectConfig(), null, 2)}\n`
  stopJsonEditing()
})
elements.refreshStatus.addEventListener('click', refreshStatus)
elements.importFile.addEventListener('change', () => {
  const [file] = elements.importFile.files
  if (file) importJson(file)
})
elements.resetButton.addEventListener('click', () => {
  elements.resetButton.hidden = true
  elements.resetConfirmation.hidden = false
})
elements.cancelReset.addEventListener('click', () => {
  elements.resetConfirmation.hidden = true
  elements.resetButton.hidden = false
})
elements.confirmReset.addEventListener('click', resetDefaults)

window.addEventListener('beforeunload', (event) => {
  if (!dirty) return
  event.preventDefault()
  event.returnValue = ''
})
window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (dirty && !jsonEditing) saveConfig()
  }
})
document.addEventListener('visibilitychange', handleVisibilityChange)

configureApiLinks()
configureNavigation()
await Promise.all([
  loadConfig(),
  document.visibilityState === 'visible' ? refreshStatus() : Promise.resolve()
])
scheduleStatusRefresh()
