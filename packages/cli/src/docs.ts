import { readFile, readdir, stat } from 'fs/promises'
import path from 'path'
import mammoth from 'mammoth'

export interface DocChunk {
  index: number
  heading: string | null
  text: string
}

export interface ParsedDoc {
  filename: string
  fullText: string
  chunks: DocChunk[]
  charCount: number
}

const CHUNK_SIZE = 2000

function chunkBySize(text: string, filename: string): DocChunk[] {
  const chunks: DocChunk[] = []
  let idx = 0
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    const slice = text.slice(i, i + CHUNK_SIZE)
    chunks.push({ index: idx++, heading: idx === 1 ? filename : null, text: slice })
  }
  return chunks
}

function chunkByHeadings(text: string): DocChunk[] {
  const headingRe = /^(#{1,3}\s.+|[A-Z][A-Z\s]{3,}[A-Z])$/gm
  const chunks: DocChunk[] = []
  let lastIdx = 0
  let lastHeading: string | null = null
  let chunkIndex = 0

  for (const m of text.matchAll(headingRe)) {
    if (m.index !== undefined && m.index > lastIdx) {
      const block = text.slice(lastIdx, m.index).trim()
      if (block.length > 0) {
        if (block.length > CHUNK_SIZE * 2) {
          for (const sub of chunkBySize(block, '')) {
            chunks.push({ index: chunkIndex++, heading: lastHeading, text: sub.text })
            lastHeading = null
          }
        } else {
          chunks.push({ index: chunkIndex++, heading: lastHeading, text: block })
        }
      }
    }
    lastHeading = m[0].replace(/^#+\s*/, '').trim()
    lastIdx = (m.index ?? 0) + m[0].length
  }

  const tail = text.slice(lastIdx).trim()
  if (tail.length > 0) {
    if (tail.length > CHUNK_SIZE * 2) {
      for (const sub of chunkBySize(tail, '')) {
        chunks.push({ index: chunkIndex++, heading: lastHeading, text: sub.text })
        lastHeading = null
      }
    } else {
      chunks.push({ index: chunkIndex++, heading: lastHeading, text: tail })
    }
  }

  return chunks.length > 0 ? chunks : chunkBySize(text, '')
}

async function parseTxt(filePath: string): Promise<string> {
  return await readFile(filePath, 'utf-8')
}

async function parseDocx(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath })
  return result.value
}

async function parseMd(filePath: string): Promise<string> {
  return await readFile(filePath, 'utf-8')
}

export async function parseDocFile(filePath: string): Promise<ParsedDoc> {
  const ext = path.extname(filePath).toLowerCase()
  let fullText: string

  if (ext === '.docx') fullText = await parseDocx(filePath)
  else if (ext === '.md' || ext === '.markdown') fullText = await parseMd(filePath)
  else fullText = await parseTxt(filePath)

  const chunks = chunkByHeadings(fullText)

  return {
    filename: path.basename(filePath),
    fullText,
    chunks,
    charCount: fullText.length
  }
}

export async function findDocFiles(rootDir: string, pattern: string): Promise<string[]> {
  const abs = path.isAbsolute(pattern) ? pattern : path.join(rootDir, pattern)
  try {
    const s = await stat(abs)
    if (s.isFile()) return [abs]
    if (s.isDirectory()) {
      const entries = await readdir(abs, { recursive: true })
      return entries
        .filter((e): e is string => typeof e === 'string' && /\.(txt|md|markdown|docx)$/i.test(e))
        .map(e => path.join(abs, e))
    }
  } catch { /* glob fallback below */ }

  const searchRoot = abs.includes('**') ? abs.split('**')[0].replace(/\/$/, '') : path.dirname(abs)
  const entries = await readdir(searchRoot, { recursive: true })
  return entries
    .filter((e): e is string => {
      if (typeof e !== 'string') return false
      const full = path.join(searchRoot, e)
      if (!/\.(txt|md|markdown|docx)$/i.test(full)) return false
      const re = new RegExp(
        abs.replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*') + '$'
      )
      return re.test(full)
    })
    .map(e => path.join(searchRoot, e))
}
