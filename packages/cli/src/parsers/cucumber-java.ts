import type { Issue } from '../types.js'

const STEP_ANNOTATION = /@(Given|When|Then|And|But)\s*\(\s*["']([^"']+)["']\s*\)/g
const STEP_METHOD = /(public|private|protected)?\s*void\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{([\s\S]*?)\n\s*\}/g

export function looksLikeCucumberJavaStepFile(filePath: string, source: string): boolean {
  if (!filePath.endsWith('.java')) return false
  return /io\.cucumber\.java|cucumber\.api\.java/.test(source) || /@(Given|When|Then)\s*\(/.test(source)
}

function lineOfOffset(source: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++
  return line
}

export function parseCucumberJava(source: string, _filePath: string): Issue[] {
  const issues: Issue[] = []

  const annotationLines: Array<{ keyword: string; text: string; line: number; endIdx: number }> = []
  let am: RegExpExecArray | null
  STEP_ANNOTATION.lastIndex = 0
  while ((am = STEP_ANNOTATION.exec(source)) !== null) {
    annotationLines.push({
      keyword: am[1],
      text: am[2],
      line: lineOfOffset(source, am.index),
      endIdx: STEP_ANNOTATION.lastIndex
    })
  }

  let mm: RegExpExecArray | null
  STEP_METHOD.lastIndex = 0
  while ((mm = STEP_METHOD.exec(source)) !== null) {
    const methodStart = mm.index
    const body = mm[3]
    const bodyLine = lineOfOffset(source, methodStart)

    const owningAnnotation = annotationLines
      .filter(a => a.endIdx <= methodStart && methodStart - a.endIdx < 200)
      .pop()
    if (!owningAnnotation) continue

    if (body.trim() === '') {
      issues.push({
        rule: 'cucumber-java-empty-step-body',
        severity: 'critical',
        message: `Step "${owningAnnotation.text}" has an empty method body — it silently passes`,
        line: owningAnnotation.line
      })
    }

    const sleepMatch = /\b(Thread\.sleep|TimeUnit\.\w+\.sleep)\s*\(\s*(\d+)\s*\)/.exec(body)
    if (sleepMatch) {
      issues.push({
        rule: 'cucumber-java-explicit-sleep',
        severity: 'warning',
        message: `Step "${owningAnnotation.text}" uses ${sleepMatch[1]}(${sleepMatch[2]}) — use explicit waits / retry instead`,
        line: bodyLine + source.slice(methodStart, methodStart + sleepMatch.index).split('\n').length - 1
      })
    }

    const printMatch = /\bSystem\.(out|err)\.(print|println)\s*\(/.exec(body)
    if (printMatch) {
      issues.push({
        rule: 'cucumber-java-print-in-step',
        severity: 'info',
        message: `Step "${owningAnnotation.text}" contains System.${printMatch[1]}.${printMatch[2]}(...) — remove debug prints before merging`,
        line: bodyLine + source.slice(methodStart, methodStart + printMatch.index).split('\n').length - 1
      })
    }
  }

  return issues
}
