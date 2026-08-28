import { spawn } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import generatedConfig from './qvac.config.mjs'

const DATA_DIR = '/data'
const CONFIG_DIR = path.join(DATA_DIR, 'config')
const CONFIG_PATH = path.join(CONFIG_DIR, 'qvac.config.json')
const CONFIG_TEMP_PATH = path.join(CONFIG_DIR, '.qvac.config.json.tmp')
const BACKUP_DIR = path.join(CONFIG_DIR, 'backups')
const API_KEY_PATH = path.join(DATA_DIR, 'runtime', 'api-key')
const UI_DIR = '/app/ui'
const MAX_BODY_BYTES = 1024 * 1024
const MAX_BACKUPS = 12
const BACKUP_NAME_PATTERN = /^qvac\.config\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/
const MODEL_REGISTRY_PATH = '/usr/local/lib/node_modules/@qvac/cli/node_modules/@qvac/sdk/dist/models/registry/models.js'
const MODEL_TYPES = new Set([
  'llm',
  'embeddings',
  'whisper',
  'parakeet',
  'nmt',
  'tts',
  'ocr',
  'whispercpp-audio-translation',
  'diffusion'
])

const MODEL_CAPABILITIES = new Map([
  ['llm', ['chat', 'Text generation']],
  ['embeddings', ['embeddings', 'Embeddings']],
  ['whisper', ['transcription', 'Transcription']],
  ['parakeet', ['transcription', 'Transcription']],
  ['nmt', ['translation', 'Translation']],
  ['tts', ['speech', 'Text to speech']],
  ['ocr', ['ocr', 'OCR']],
  ['diffusion', ['images', 'Image generation']]
])

const MODEL_PRESETS = {
  QWEN3_600M_INST_Q4: {
    title: 'Qwen 3 600M',
    description: 'Smallest general chat model and the fastest option on CPU.',
    alias: 'qwen3-600m',
    recommended: true,
    config: { ctx_size: 4096 }
  },
  QWEN3_1_7B_INST_Q4: {
    title: 'Qwen 3 1.7B',
    description: 'Strong balance of response quality, memory use, and CPU speed.',
    alias: 'qwen3-1.7b',
    recommended: true,
    config: { ctx_size: 4096 }
  },
  QWEN3_4B_INST_Q4_K_M: {
    title: 'Qwen 3 4B',
    description: 'More capable chat model for nodes with at least 6–8 GB of free memory.',
    alias: 'qwen3-4b',
    recommended: true,
    config: { ctx_size: 4096 }
  },
  QWEN3_8B_INST_Q4_K_M: {
    title: 'Qwen 3 8B',
    description: 'Higher-quality text generation with a much larger memory and CPU cost.',
    alias: 'qwen3-8b',
    config: { ctx_size: 4096 }
  },
  QWEN3_8_27B_MULTIMODAL_UD_Q4_K_XL: {
    title: 'Qwen 3.8 27B Multimodal Q4',
    description: 'Large vision-language model for image understanding and text generation.',
    alias: 'qwen3.8-27b-vision',
    config: { ctx_size: 4096 }
  },
  LLAMA_3_2_1B_INST_Q4_0: {
    title: 'Llama 3.2 1B',
    description: 'Compact instruction model for lightweight assistants and automation.',
    alias: 'llama-3.2-1b',
    config: { ctx_size: 4096 }
  },
  LLAMA_TOOL_CALLING_1B_INST_Q4_K: {
    title: 'Llama tool calling 1B',
    description: 'Lightweight model tuned for structured tool-calling workflows.',
    alias: 'llama-tools-1b',
    config: { ctx_size: 4096, tools: true }
  },
  EMBEDDINGGEMMA_300M_Q4_0: {
    title: 'EmbeddingGemma 300M',
    description: 'Compact embedding model for semantic search and RAG.',
    alias: 'embeddinggemma-300m',
    recommended: true
  },
  GTE_LARGE_FP16: {
    title: 'GTE Large',
    description: 'Higher-precision text embeddings for search and retrieval.',
    alias: 'gte-large'
  },
  WHISPER_SMALL_Q8_0: {
    title: 'Whisper Small Q8',
    description: 'Multilingual speech recognition with a practical accuracy and size balance.',
    alias: 'whisper-small',
    recommended: true
  },
  WHISPER_LARGE_V3_TURBO: {
    title: 'Whisper Large v3 Turbo',
    description: 'Highest-quality Whisper option in this runtime, with a larger resource cost.',
    alias: 'whisper-large-v3-turbo'
  },
  PARAKEET_TDT_0_6B_V3_Q4_0: {
    title: 'Parakeet TDT 0.6B',
    description: 'Compact multilingual transcription model.',
    alias: 'parakeet-tdt-600m',
    recommended: true
  },
  TTS_MULTILINGUAL_SUPERTONIC3_Q4_0: {
    title: 'Supertonic 3 multilingual',
    description: 'Fast multilingual speech synthesis with a compact download.',
    alias: 'supertonic-multilingual',
    recommended: true,
    config: { ttsEngine: 'supertonic', language: 'en', voice: 'F1' }
  },
  TTS_EN_SUPERTONIC_Q4_0: {
    title: 'Supertonic English',
    description: 'Fast and compact English speech synthesis.',
    alias: 'supertonic-en',
    config: { ttsEngine: 'supertonic', language: 'en', voice: 'F1' }
  },
  TTS_MINI_V1_EN_PARLER_TTS_Q8_0: {
    title: 'Parler Mini English',
    description: 'Description-conditioned English speech with expressive voice controls.',
    alias: 'parler-mini-en',
    config: { ttsEngine: 'parler', voice: 'Laura', seed: 42 }
  },
  SD_V2_1_1B_Q4_0: {
    title: 'Stable Diffusion 2.1 Q4',
    description: 'Single-file image generation model; compact but slow without GPU access.',
    alias: 'stable-diffusion-2.1',
    recommended: true,
    config: { prediction: 'v' }
  },
  SD_V2_1_1B_Q8_0: {
    title: 'Stable Diffusion 2.1 Q8',
    description: 'Higher-precision image generation with a slightly larger download.',
    alias: 'stable-diffusion-2.1-q8',
    config: { prediction: 'v' }
  }
}

const FALLBACK_MODELS = [
  ['QWEN3_600M_INST_Q4', 'llm', 382333824, '600M', 'q4'],
  ['QWEN3_1_7B_INST_Q4', 'llm', 1052267392, '1.7B', 'q4'],
  ['QWEN3_4B_INST_Q4_K_M', 'llm', 2501815168, '4B', 'q4_k_m'],
  ['QWEN3_8B_INST_Q4_K_M', 'llm', 5025111168, '8B', 'q4_k_m'],
  ['QWEN3_8_27B_MULTIMODAL_UD_Q4_K_XL', 'llm', 17923394624, '27B', 'UD-Q4_K_XL'],
  ['MMPROJ_QWEN3_8_27B_MULTIMODAL_F16', 'llm', 927607488, '27B', 'f16'],
  ['EMBEDDINGGEMMA_300M_Q4_0', 'embeddings', 279172992, '300M', 'q4_0'],
  ['WHISPER_SMALL_Q8_0', 'whisper', 267000000, '', 'q8_0'],
  ['PARAKEET_TDT_0_6B_V3_Q4_0', 'parakeet', 397000000, '0.6B', 'q4_0'],
  ['TTS_EN_SUPERTONIC_Q4_0', 'tts', 129000000, '', 'q4_0'],
  ['SD_V2_1_1B_Q4_0', 'diffusion', 2190000000, '1B', 'q4_0']
].map(([name, addon, expectedSize, params, quantization]) => ({
  name,
  addon,
  expectedSize,
  params,
  quantization
}))

const apiPort = positiveInteger(process.env.QVAC_API_PORT, 11434)
const uiPort = positiveInteger(process.env.QVAC_UI_PORT, 8080)
const apiKey = (process.env.QVAC_API_KEY ?? '').trim()

let worker = null
let intentionalStop = false
let shuttingDown = false
let restartChain = Promise.resolve()
let unexpectedRestartTimer = null

const runtime = {
  state: 'starting',
  pid: null,
  startedAt: null,
  lastExit: null,
  restartCount: 0,
  configSource: existsSync(CONFIG_PATH) ? 'custom' : 'generated'
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function timestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function isStandaloneCatalogModel(model, multimodalProjections) {
  if (!MODEL_CAPABILITIES.has(model.addon)) return false
  if (model.name.startsWith('MMPROJ_') || /_(SHARD|TENSORS)$/.test(model.name)) return false

  if (model.addon === 'llm') {
    return !model.name.includes('_MULTIMODAL_') || multimodalProjections.has(model.name)
  }
  if (model.addon === 'nmt') return Boolean(model.companionSet) && model.name !== 'BERGAMOT'
  if (model.addon === 'tts') {
    return model.name.includes('SUPERTONIC') || model.name.includes('PARLER_TTS')
  }
  if (model.addon === 'whisper') return !model.name.startsWith('VAD_')
  if (model.addon === 'diffusion') return model.name.startsWith('SD_V2_1_1B_')
  return true
}

function multimodalFamily(name) {
  return /^(?:MMPROJ_)?(.+)_MULTIMODAL_/.exec(name)?.[1] ?? null
}

function registryDirectory(model) {
  if (typeof model.registryPath !== 'string') return null
  return model.registryPath.slice(0, model.registryPath.lastIndexOf('/'))
}

function multimodalProjectionMap(registryModels) {
  const projectionsByFamily = new Map()
  for (const model of registryModels) {
    if (!model.name.startsWith('MMPROJ_')) continue
    const family = multimodalFamily(model.name)
    if (!family) continue
    const projections = projectionsByFamily.get(family) ?? []
    projections.push(model)
    projectionsByFamily.set(family, projections)
  }

  const result = new Map()
  for (const model of registryModels) {
    if (model.addon !== 'llm' || model.name.startsWith('MMPROJ_') || !model.name.includes('_MULTIMODAL_')) continue
    const family = multimodalFamily(model.name)
    const modelDirectory = registryDirectory(model)
    const familyProjections = projectionsByFamily.get(family) ?? []
    const candidates = modelDirectory
      ? familyProjections.filter((projection) => registryDirectory(projection) === modelDirectory)
      : familyProjections
    candidates.sort((a, b) => projectionPreference(a, model) - projectionPreference(b, model))
    if (candidates[0]) result.set(model.name, candidates[0])
  }
  return result
}

function projectionPreference(projection, model) {
  if (projection.quantization === model.quantization) return 0
  if (projection.quantization === 'q8_0') return 1
  if (projection.quantization === 'f16') return 2
  if (projection.quantization === 'bf16') return 3
  return 4
}

function languageName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code.toLowerCase()) ?? code
  } catch {
    return code
  }
}

function modelTitle(model) {
  const preset = MODEL_PRESETS[model.name]
  if (preset?.title) return preset.title

  const translation = /^BERGAMOT_([A-Z]+)_([A-Z]+)$/.exec(model.name)
  if (translation) return `${languageName(translation[1])} → ${languageName(translation[2])}`

  return model.name
    .replaceAll('_', ' ')
    .replace(/\bINST\b/g, 'Instruct')
    .replace(/\bMULTILINGUAL\b/g, 'Multilingual')
    .replace(/\bEN\b/g, 'English')
    .replace(/\bQ(\d(?:_[A-Z0-9]+)*)\b/g, 'Q$1')
    .replace(/\bTTS\b/g, 'TTS')
    .replace(/\bOCR\b/g, 'OCR')
}

function modelDescription(model, capability) {
  const preset = MODEL_PRESETS[model.name]
  if (preset?.description) return preset.description

  const translation = /^BERGAMOT_([A-Z]+)_([A-Z]+)$/.exec(model.name)
  if (translation) {
    return `Offline translation from ${languageName(translation[1])} to ${languageName(translation[2])}.`
  }

  return {
    chat: 'Local text generation and chat model.',
    vision: 'Vision-language model for local image understanding and text generation.',
    embeddings: 'Vector embeddings for semantic search and RAG.',
    transcription: model.addon === 'parakeet'
      ? 'Speech recognition powered by NVIDIA Parakeet.'
      : 'Local speech recognition powered by Whisper.',
    speech: 'Local text-to-speech synthesis.',
    images: 'Local image generation powered by Stable Diffusion.',
    ocr: 'Extract text from images locally.'
  }[capability] ?? 'Local QVAC model.'
}

function suggestedAlias(model) {
  const preset = MODEL_PRESETS[model.name]
  if (preset?.alias) return preset.alias

  const translation = /^BERGAMOT_([A-Z]+)_([A-Z]+)$/.exec(model.name)
  if (translation) return `translate-${translation[1].toLowerCase()}-${translation[2].toLowerCase()}`

  return model.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

function defaultModelConfig(model, projectionModel) {
  const preset = MODEL_PRESETS[model.name]
  let config
  if (preset?.config) config = structuredClone(preset.config)
  else if (model.addon === 'llm') config = { ctx_size: 4096 }
  else if (model.addon === 'tts' && model.name.includes('SUPERTONIC')) {
    config = { ttsEngine: 'supertonic', language: 'en', voice: 'F1' }
  } else if (model.addon === 'tts' && model.name.includes('PARLER_TTS')) {
    config = { ttsEngine: 'parler', voice: 'Laura' }
  } else if (model.addon === 'diffusion') config = { prediction: 'v' }
  else config = {}

  if (projectionModel) config.projectionModelSrc = projectionModel.name
  return config
}

function modelDownloadSize(model, projectionModel) {
  const modelSize = !model.companionSet?.files?.length
    ? model.expectedSize ?? 0
    : model.companionSet.files.reduce((total, file) => total + (file.expectedSize ?? 0), 0)
  return modelSize + (projectionModel?.expectedSize ?? 0)
}

function resourceTier(bytes) {
  if (bytes < 1024 ** 3) return 'light'
  if (bytes < 3 * 1024 ** 3) return 'medium'
  if (bytes < 6 * 1024 ** 3) return 'heavy'
  return 'extreme'
}

function catalogEntry(model, projectionModel) {
  const [baseCapability, baseCapabilityLabel] = MODEL_CAPABILITIES.get(model.addon)
  const capability = projectionModel ? 'vision' : baseCapability
  const capabilityLabel = projectionModel ? 'Vision + text' : baseCapabilityLabel
  const downloadSize = modelDownloadSize(model, projectionModel)
  return {
    name: model.name,
    title: modelTitle(model),
    description: modelDescription(model, capability),
    alias: suggestedAlias(model),
    capability,
    capabilityLabel,
    engine: model.engine ?? '',
    params: model.params ?? '',
    quantization: model.quantization ?? '',
    downloadSize,
    resourceTier: resourceTier(downloadSize),
    recommended: Boolean(MODEL_PRESETS[model.name]?.recommended),
    config: defaultModelConfig(model, projectionModel)
  }
}

let modelCatalogPromise = null

async function modelCatalog() {
  if (!modelCatalogPromise) {
    modelCatalogPromise = (async () => {
      let registryModels
      try {
        const registry = await import(pathToFileURL(MODEL_REGISTRY_PATH).href)
        registryModels = registry.models
      } catch (error) {
        console.warn(`[config-manager] Could not read the QVAC model registry: ${error.message}`)
        registryModels = FALLBACK_MODELS
      }

      const multimodalProjections = multimodalProjectionMap(registryModels)
      const capabilityOrder = ['chat', 'vision', 'embeddings', 'transcription', 'translation', 'speech', 'images', 'ocr']
      return registryModels
        .filter((model) => isStandaloneCatalogModel(model, multimodalProjections))
        .map((model) => catalogEntry(model, multimodalProjections.get(model.name)))
        .sort((a, b) => {
          if (a.recommended !== b.recommended) return a.recommended ? -1 : 1
          const capabilityDifference = capabilityOrder.indexOf(a.capability) - capabilityOrder.indexOf(b.capability)
          if (capabilityDifference !== 0) return capabilityDifference
          if (a.downloadSize !== b.downloadSize) return a.downloadSize - b.downloadSize
          return a.name.localeCompare(b.name)
        })
    })()
  }
  return modelCatalogPromise
}

async function prepareDataDirectories() {
  await mkdir(CONFIG_DIR, { recursive: true })
  await mkdir(BACKUP_DIR, { recursive: true })
  await mkdir(path.dirname(API_KEY_PATH), { recursive: true })
  await mkdir(path.join(DATA_DIR, 'models'), { recursive: true })

  if (apiKey) {
    await writeFile(API_KEY_PATH, apiKey, { mode: 0o600 })
  } else if (existsSync(API_KEY_PATH)) {
    await unlink(API_KEY_PATH)
  }
}

async function readActiveConfig() {
  if (!existsSync(CONFIG_PATH)) return structuredClone(generatedConfig)
  return JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
}

async function listBackups() {
  const names = (await readdir(BACKUP_DIR))
    .filter((name) => BACKUP_NAME_PATTERN.test(name))
    .sort()
    .reverse()

  return Promise.all(
    names.map(async (name) => {
      const details = await stat(path.join(BACKUP_DIR, name))
      return { name, savedAt: details.mtime.toISOString(), size: details.size }
    })
  )
}

async function pruneBackups() {
  const backups = await listBackups()
  await Promise.all(
    backups.slice(MAX_BACKUPS).map((backup) => unlink(path.join(BACKUP_DIR, backup.name)))
  )
}

async function backupCurrentConfig() {
  if (!existsSync(CONFIG_PATH)) return null
  const name = `qvac.config.${timestamp()}.json`
  await copyFile(CONFIG_PATH, path.join(BACKUP_DIR, name))
  await pruneBackups()
  return name
}

async function writeConfig(config) {
  await writeFile(CONFIG_TEMP_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await rename(CONFIG_TEMP_PATH, CONFIG_PATH)
  runtime.configSource = 'custom'
}

function validateOrigin(value, label, errors) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
      errors.push(`${label} must be an exact HTTP(S) origin without a path, query, or fragment.`)
    }
  } catch {
    errors.push(`${label} must be a valid HTTP(S) origin.`)
  }
}

function validateConfig(config) {
  const errors = []

  if (!isObject(config)) return ['Configuration must be a JSON object.']

  if (config.cacheDirectory !== undefined) {
    if (typeof config.cacheDirectory !== 'string' || !path.isAbsolute(config.cacheDirectory)) {
      errors.push('cacheDirectory must be an absolute path.')
    } else if (config.cacheDirectory !== DATA_DIR && !config.cacheDirectory.startsWith(`${DATA_DIR}/`)) {
      errors.push('cacheDirectory must be inside /data so downloaded models remain persistent.')
    }
  }

  if (
    config.loggerLevel !== undefined &&
    !['error', 'warn', 'info', 'debug'].includes(config.loggerLevel)
  ) {
    errors.push('loggerLevel must be error, warn, info, or debug.')
  }

  if (
    config.loggerConsoleOutput !== undefined &&
    typeof config.loggerConsoleOutput !== 'boolean'
  ) {
    errors.push('loggerConsoleOutput must be true or false.')
  }

  for (const field of [
    'httpDownloadConcurrency',
    'httpConnectionTimeoutMs',
    'registryDownloadMaxRetries',
    'registryStreamTimeoutMs'
  ]) {
    if (
      config[field] !== undefined &&
      (!Number.isSafeInteger(config[field]) || config[field] < 1)
    ) {
      errors.push(`${field} must be a positive integer.`)
    }
  }

  if (!isObject(config.serve)) {
    errors.push('serve must be an object.')
    return errors
  }

  if (!isObject(config.serve.models) || Object.keys(config.serve.models).length === 0) {
    errors.push('serve.models must contain at least one model.')
    return errors
  }

  if (config.serve.publicBaseUrl !== undefined && config.serve.publicBaseUrl !== '') {
    validateOrigin(config.serve.publicBaseUrl, 'serve.publicBaseUrl', errors)
  }

  if (config.serve.cors !== undefined) {
    if (!isObject(config.serve.cors)) {
      errors.push('serve.cors must be an object.')
    } else if (config.serve.cors.origins !== undefined) {
      if (!Array.isArray(config.serve.cors.origins)) {
        errors.push('serve.cors.origins must be an array.')
      } else {
        config.serve.cors.origins.forEach((origin, index) => {
          if (typeof origin !== 'string' || origin === '*') {
            errors.push(`serve.cors.origins[${index}] must be an exact HTTP(S) origin.`)
          } else {
            validateOrigin(origin, `serve.cors.origins[${index}]`, errors)
          }
        })
      }
    }
  }

  for (const [alias, entry] of Object.entries(config.serve.models)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(alias)) {
      errors.push(`Model alias "${alias}" must use 1–64 letters, numbers, dots, underscores, or hyphens.`)
    }

    if (typeof entry === 'string') {
      if (!entry.trim()) errors.push(`Model "${alias}" must name a QVAC model constant.`)
      continue
    }

    if (!isObject(entry)) {
      errors.push(`Model "${alias}" must be a model constant string or an object.`)
      continue
    }

    const hasConstant = typeof entry.model === 'string' && entry.model.trim() !== ''
    const hasSource = typeof entry.src === 'string' && entry.src.trim() !== ''

    if (hasConstant === hasSource) {
      errors.push(`Model "${alias}" must define either model or src, but not both.`)
    }

    if (hasSource && !MODEL_TYPES.has(entry.type)) {
      errors.push(`Model "${alias}" must define a supported type when using src.`)
    }

    if (entry.default !== undefined && typeof entry.default !== 'boolean') {
      errors.push(`Model "${alias}" default must be true or false.`)
    }

    if (entry.preload !== undefined && typeof entry.preload !== 'boolean') {
      errors.push(`Model "${alias}" preload must be true or false.`)
    }

    if (entry.config !== undefined && !isObject(entry.config)) {
      errors.push(`Model "${alias}" config must be an object.`)
    }
  }

  return errors
}

function workerArguments() {
  const configPath = existsSync(CONFIG_PATH) ? CONFIG_PATH : '/app/qvac.config.mjs'
  runtime.configSource = existsSync(CONFIG_PATH) ? 'custom' : 'generated'

  const args = [
    'serve',
    'openai',
    '--config',
    configPath,
    '--host',
    '0.0.0.0',
    '--port',
    String(apiPort),
    '--docs'
  ]

  if (apiKey) args.push('--api-key-file', API_KEY_PATH)
  else args.push('--allow-unauthenticated')

  return { args, configPath }
}

async function startWorker() {
  if (shuttingDown) return
  const { args, configPath } = workerArguments()

  runtime.state = 'loading'
  runtime.startedAt = new Date().toISOString()
  runtime.lastExit = null

  const child = spawn('qvac', args, {
    env: { ...process.env, QVAC_CONFIG_PATH: configPath },
    stdio: 'inherit'
  })

  worker = child
  runtime.pid = child.pid

  child.once('error', (error) => {
    runtime.state = 'error'
    runtime.lastExit = { at: new Date().toISOString(), error: error.message }
  })

  child.once('exit', (code, signal) => {
    if (worker === child) worker = null
    runtime.pid = null
    runtime.lastExit = { at: new Date().toISOString(), code, signal }

    if (shuttingDown || intentionalStop) return

    runtime.state = 'restarting'
    runtime.restartCount += 1
    unexpectedRestartTimer = setTimeout(() => {
      startWorker().catch((error) => {
        runtime.state = 'error'
        runtime.lastExit = { at: new Date().toISOString(), error: error.message }
      })
    }, 3000)
    unexpectedRestartTimer.unref()
  })
}

async function stopWorker() {
  if (!worker || worker.exitCode !== null) return
  const child = worker

  await new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, 10000)
    forceTimer.unref()
    child.once('exit', () => {
      clearTimeout(forceTimer)
      finish()
    })
    child.kill('SIGTERM')
  })
}

function restartWorker() {
  restartChain = restartChain.then(async () => {
    runtime.state = 'restarting'
    intentionalStop = true
    await stopWorker()
    intentionalStop = false
    runtime.restartCount += 1
    await startWorker()
  })
  return restartChain
}

async function qvacHealth() {
  if (!worker) return { state: runtime.state, models: [] }

  try {
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    const response = await fetch(`http://127.0.0.1:${apiPort}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(1800)
    })
    if (!response.ok) return { state: 'loading', models: [] }
    const payload = await response.json()
    runtime.state = 'online'
    return { state: 'online', models: Array.isArray(payload.data) ? payload.data : [] }
  } catch {
    if (!['restarting', 'error'].includes(runtime.state)) runtime.state = 'loading'
    return { state: runtime.state, models: [] }
  }
}

async function statusPayload() {
  const health = await qvacHealth()
  return {
    ...runtime,
    state: health.state,
    models: health.models,
    authenticated: Boolean(apiKey),
    apiPort,
    uiPort,
    qvacVersion: process.env.QVAC_VERSION ?? 'unknown'
  }
}

function securityHeaders(contentType) {
  return {
    'Cache-Control': contentType?.includes('text/html') ? 'no-store' : 'no-cache',
    'Content-Security-Policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...(contentType ? { 'Content-Type': contentType } : {})
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...securityHeaders('application/json; charset=utf-8'),
    'Cache-Control': 'no-store'
  })
  response.end(`${JSON.stringify(payload)}\n`)
}

function sendError(response, statusCode, message, details = []) {
  sendJson(response, statusCode, { error: message, details })
}

async function readJsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw Object.assign(new Error('Content-Type must be application/json.'), { statusCode: 415 })
  }

  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 })
    }
    chunks.push(chunk)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('Request body must contain valid JSON.'), { statusCode: 400 })
  }
}

function verifyWriteRequest(request) {
  return request.headers['x-qvac-ui'] === '1'
}

async function serveStatic(request, response, pathname) {
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/avatar.png', ['avatar.png', 'image/png']]
  ])
  const asset = assets.get(pathname)
  if (!asset) return false

  const [fileName, contentType] = asset
  const filePath = path.join(UI_DIR, fileName)
  const details = await stat(filePath)
  response.writeHead(200, {
    ...securityHeaders(contentType),
    'Content-Length': details.size
  })
  if (request.method === 'HEAD') response.end()
  else createReadStream(filePath).pipe(response)
  return true
}

async function handleApi(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/status') {
    sendJson(response, 200, await statusPayload())
    return true
  }

  if (request.method === 'GET' && pathname === '/api/models/catalog') {
    const models = await modelCatalog()
    sendJson(response, 200, { models, total: models.length })
    return true
  }

  if (request.method === 'GET' && pathname === '/api/config') {
    const config = await readActiveConfig()
    const configDetails = existsSync(CONFIG_PATH) ? await stat(CONFIG_PATH) : null
    sendJson(response, 200, {
      config,
      source: existsSync(CONFIG_PATH) ? 'custom' : 'generated',
      savedAt: configDetails?.mtime.toISOString() ?? null,
      backups: await listBackups()
    })
    return true
  }

  if (request.method === 'GET' && pathname === '/api/export') {
    const config = await readActiveConfig()
    const body = `${JSON.stringify(config, null, 2)}\n`
    response.writeHead(200, {
      ...securityHeaders('application/json; charset=utf-8'),
      'Cache-Control': 'no-store',
      'Content-Disposition': 'attachment; filename="qvac.config.json"',
      'Content-Length': Buffer.byteLength(body)
    })
    response.end(body)
    return true
  }

  if (request.method === 'POST' && pathname === '/api/validate') {
    if (!verifyWriteRequest(request)) {
      sendError(response, 403, 'Missing configuration-manager request header.')
      return true
    }
    const body = await readJsonBody(request)
    const errors = validateConfig(body.config)
    if (errors.length) sendError(response, 422, 'Configuration is not valid.', errors)
    else sendJson(response, 200, { valid: true })
    return true
  }

  if (request.method === 'PUT' && pathname === '/api/config') {
    if (!verifyWriteRequest(request)) {
      sendError(response, 403, 'Missing configuration-manager request header.')
      return true
    }
    const body = await readJsonBody(request)
    const errors = validateConfig(body.config)
    if (errors.length) {
      sendError(response, 422, 'Configuration is not valid.', errors)
      return true
    }

    const backup = await backupCurrentConfig()
    await writeConfig(body.config)
    await restartWorker()
    sendJson(response, 200, { saved: true, backup, status: await statusPayload() })
    return true
  }

  if (request.method === 'POST' && pathname === '/api/reset') {
    if (!verifyWriteRequest(request)) {
      sendError(response, 403, 'Missing configuration-manager request header.')
      return true
    }
    await readJsonBody(request)
    const backup = await backupCurrentConfig()
    if (existsSync(CONFIG_PATH)) await unlink(CONFIG_PATH)
    runtime.configSource = 'generated'
    await restartWorker()
    sendJson(response, 200, { reset: true, backup, config: structuredClone(generatedConfig) })
    return true
  }

  if (request.method === 'POST' && pathname === '/api/backups/restore') {
    if (!verifyWriteRequest(request)) {
      sendError(response, 403, 'Missing configuration-manager request header.')
      return true
    }
    const body = await readJsonBody(request)
    if (typeof body.name !== 'string' || !BACKUP_NAME_PATTERN.test(body.name)) {
      sendError(response, 400, 'Backup name is not valid.')
      return true
    }

    const backupPath = path.join(BACKUP_DIR, body.name)
    if (!existsSync(backupPath)) {
      sendError(response, 404, 'Backup was not found.')
      return true
    }

    const restoredConfig = JSON.parse(await readFile(backupPath, 'utf8'))
    const errors = validateConfig(restoredConfig)
    if (errors.length) {
      sendError(response, 422, 'The selected backup is not valid.', errors)
      return true
    }

    await backupCurrentConfig()
    await writeConfig(restoredConfig)
    await restartWorker()
    sendJson(response, 200, { restored: true, config: restoredConfig })
    return true
  }

  return false
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

    if (url.pathname.startsWith('/api/')) {
      if (!(await handleApi(request, response, url.pathname))) {
        sendError(response, 404, 'API route not found.')
      }
      return
    }

    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      sendError(response, 405, 'Method not allowed.')
      return
    }

    if (!(await serveStatic(request, response, url.pathname))) {
      sendError(response, 404, 'Page not found.')
    }
  } catch (error) {
    console.error('[config-manager]', error)
    if (!response.headersSent) {
      sendError(response, error.statusCode ?? 500, error.statusCode ? error.message : 'Unexpected server error.')
    } else {
      response.end()
    }
  }
})

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  runtime.state = 'stopping'
  if (unexpectedRestartTimer) clearTimeout(unexpectedRestartTimer)
  console.log(`[config-manager] Received ${signal}; stopping QVAC.`)
  server.close()
  intentionalStop = true
  await stopWorker()
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

await prepareDataDirectories()
await startWorker()

server.listen(uiPort, '0.0.0.0', () => {
  console.log(`[config-manager] QVAC configuration UI listening on http://0.0.0.0:${uiPort}`)
})
