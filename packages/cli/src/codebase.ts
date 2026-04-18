import { readFile, readdir, stat } from 'fs/promises'
import path from 'path'

export interface CodebaseFile {
  relativePath: string
  absolutePath: string
  layer: 'controller' | 'service' | 'model' | 'middleware' | 'config' | 'other'
  language: string
  content: string
  lineCount: number
}

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', '.svn', '.hg', 'target',
  '__pycache__', '.gradle', '.idea', '.vscode', 'vendor', 'coverage',
  'test', 'tests', 'spec', 'specs', 'e2e', '__tests__', '__test__',
  'fixtures', 'mocks', 'stubs'
])

const SKIP_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.scss', '.less',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2',
  '.ttf', '.eot', '.map', '.lock', '.log', '.md', '.txt', '.docx',
  '.pdf', '.zip', '.tar', '.gz', '.jar', '.war', '.class', '.pyc'
])

const CODE_EXTENSIONS = new Set([
  '.java', '.kt', '.kts', '.scala',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py',
  '.go',
  '.rb',
  '.cs',
  '.rs',
  '.php',
  '.ex', '.exs'
])

interface LayerPattern {
  layer: CodebaseFile['layer']
  filePatterns: RegExp[]
  contentPatterns: RegExp[]
}

const LAYER_PATTERNS: LayerPattern[] = [
  {
    layer: 'controller',
    filePatterns: [
      /controller/i, /router/i, /route/i, /handler/i, /endpoint/i,
      /resource\.(?:java|kt|ts|js|py|rb|go|cs)$/i,
      /\.controller\./i, /\.routes?\./i
    ],
    contentPatterns: [
      /@(Get|Post|Put|Delete|Patch|Request)Mapping/,
      /@(Get|Post|Put|Delete|Patch|Head|Options)\b/,
      /app\.(get|post|put|delete|patch|use)\s*\(/,
      /router\.(get|post|put|delete|patch)\s*\(/,
      /\[Http(Get|Post|Put|Delete|Patch)\]/,
      /@app\.(get|post|put|delete|patch|route)\s*\(/,
      /func\s+\w+.*http\.(ResponseWriter|Request)/
    ]
  },
  {
    layer: 'service',
    filePatterns: [
      /service/i, /usecase/i, /use-case/i, /manager/i, /facade/i,
      /interactor/i, /business/i, /domain.*service/i,
      /\.service\./i
    ],
    contentPatterns: [
      /@Service\b/, /@Injectable\b/, /@Component\b/,
      /class\s+\w+Service\b/, /class\s+\w+UseCase\b/
    ]
  },
  {
    layer: 'model',
    filePatterns: [
      /entity/i, /model/i, /schema/i, /dto/i, /domain/i,
      /\.entity\./i, /\.model\./i, /\.dto\./i,
      /migration/i
    ],
    contentPatterns: [
      /@Entity\b/, /@Table\b/, /@Column\b/,
      /mongoose\.Schema/, /sequelize\.define/,
      /class\s+\w+Entity\b/, /class\s+\w+DTO\b/,
      /@Min\b/, /@Max\b/, /@NotNull\b/, /@NotBlank\b/, /@Size\b/
    ]
  },
  {
    layer: 'middleware',
    filePatterns: [
      /middleware/i, /filter/i, /guard/i, /interceptor/i,
      /auth/i, /security/i, /permission/i, /rbac/i,
      /\.middleware\./i, /\.guard\./i, /\.filter\./i
    ],
    contentPatterns: [
      /@PreAuthorize\b/, /@Secured\b/, /@RolesAllowed\b/,
      /CanActivate/, /NestMiddleware/,
      /passport\.\w+/, /jwt\.verify/
    ]
  },
  {
    layer: 'config',
    filePatterns: [
      /config/i, /configuration/i, /properties$/i, /settings/i,
      /application\.yml$/, /application\.properties$/,
      /\.env\.example$/
    ],
    contentPatterns: [
      /@Configuration\b/, /@ConfigurationProperties\b/,
      /@Value\b/
    ]
  }
]

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.scala': 'scala',
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.mjs': 'javascript', '.cjs': 'javascript',
    '.py': 'python', '.go': 'go', '.rb': 'ruby', '.cs': 'csharp',
    '.rs': 'rust', '.php': 'php', '.ex': 'elixir', '.exs': 'elixir'
  }
  return map[ext] ?? 'unknown'
}

function classifyLayer(filePath: string, content: string): CodebaseFile['layer'] {
  for (const lp of LAYER_PATTERNS) {
    if (lp.filePatterns.some(re => re.test(filePath))) return lp.layer
    if (lp.contentPatterns.some(re => re.test(content))) return lp.layer
  }
  return 'other'
}

async function* walkCodebase(dir: string): AsyncGenerator<string> {
  let entries: string[]
  try { entries = await readdir(dir) } catch { return }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    if (entry.startsWith('.')) continue
    const full = path.join(dir, entry)
    let s
    try { s = await stat(full) } catch { continue }
    if (s.isDirectory()) {
      yield* walkCodebase(full)
    } else if (s.isFile()) {
      const ext = path.extname(entry).toLowerCase()
      if (SKIP_EXTENSIONS.has(ext)) continue
      if (!CODE_EXTENSIONS.has(ext)) continue
      yield full
    }
  }
}

export async function scanCodebase(rootDir: string): Promise<CodebaseFile[]> {
  const results: CodebaseFile[] = []
  for await (const filePath of walkCodebase(rootDir)) {
    const content = await readFile(filePath, 'utf-8')
    const lineCount = content.split('\n').length
    if (lineCount > 2000) continue
    const layer = classifyLayer(filePath, content)
    if (layer === 'other') continue

    results.push({
      relativePath: path.relative(rootDir, filePath),
      absolutePath: filePath,
      layer,
      language: detectLanguage(filePath),
      content,
      lineCount
    })
  }

  results.sort((a, b) => {
    const order: Record<string, number> = { controller: 0, middleware: 1, service: 2, model: 3, config: 4, other: 5 }
    return (order[a.layer] ?? 5) - (order[b.layer] ?? 5)
  })

  return results
}

export function summarizeForPrompt(files: CodebaseFile[], maxChars = 80_000): string {
  const chunks: string[] = []
  let total = 0
  for (const f of files) {
    const header = `--- ${f.layer.toUpperCase()} | ${f.relativePath} (${f.language}, ${f.lineCount} lines) ---`
    const block = header + '\n' + f.content
    if (total + block.length > maxChars) {
      const remaining = maxChars - total
      if (remaining > 500) chunks.push(header + '\n' + f.content.slice(0, remaining - header.length) + '\n[...truncated]')
      break
    }
    chunks.push(block)
    total += block.length
  }
  return chunks.join('\n\n')
}
