/**
 * Build dynamic Host TypeScript and Client TSX function bodies into the plain
 * JavaScript artifacts consumed by the two existing runtime evaluators.
 * @module @deepseek-ai/dsh-cordis-host-runner/compiler
 */

import ts from 'typescript'

/** Runtime half being compiled. */
export type DynamicCordisSourceHalf = 'host' | 'client'

/** One successful in-memory build. */
export interface DynamicCordisBuild {
  /** Original author source retained for inspection and later versions. */
  source: string
  /** Plain JavaScript function body executed by the existing evaluator. */
  code: string
}

/** Render the first TypeScript error without ANSI terminal escapes. */
function diagnosticMessage(
  sourceFile: ts.SourceFile,
  diagnostic: ts.Diagnostic,
  half: DynamicCordisSourceHalf,
): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  if (diagnostic.start === undefined) return `code.${half} TypeScript compile failed: ${message}`
  const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start)
  return `code.${half} TypeScript compile failed at ${position.line + 1}:${position.character + 1}: ${message}`
}

/** Whether a top-level statement requires module loading unavailable to a closure body. */
function isModuleStatement(statement: ts.Statement): boolean {
  if (ts.isImportDeclaration(statement)
    || ts.isImportEqualsDeclaration(statement)
    || ts.isExportAssignment(statement)
    || ts.isExportDeclaration(statement)
    || ts.isNamespaceExportDeclaration(statement)) return true
  return ts.canHaveModifiers(statement)
    && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
}

/**
 * Compile one dynamic function body. Host input is parsed as TypeScript and
 * Client input as TSX. Client JSX lowers to `React.createElement`, using the
 * `React` parameter already supplied by the browser evaluator; imports and
 * exports reject because neither evaluator implements module resolution.
 * @param source - JavaScript, TypeScript, or (for Client) TSX function body.
 * @param half - evaluator that will consume the emitted JavaScript.
 * @returns the original source and executable JavaScript artifact.
 */
export function compileDynamicCordisSource(
  source: string,
  half: DynamicCordisSourceHalf,
): DynamicCordisBuild {
  const fileName = half === 'client' ? 'dynamic-client.tsx' : 'dynamic-host.ts'
  const scriptKind = half === 'client' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, scriptKind)
  if (sourceFile.statements.some(isModuleStatement)) {
    throw new Error(
      `code.${half} cannot use import or export declarations; dynamic halves are function bodies with no module resolver`,
    )
  }

  const compiled = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleDetection: ts.ModuleDetectionKind.Legacy,
      jsx: ts.JsxEmit.React,
      newLine: ts.NewLineKind.LineFeed,
      removeComments: false,
      sourceMap: false,
      inlineSourceMap: false,
      isolatedModules: true,
    },
  })
  const diagnostic = compiled.diagnostics?.find(candidate => candidate.category === ts.DiagnosticCategory.Error)
  if (diagnostic !== undefined) throw new Error(diagnosticMessage(sourceFile, diagnostic, half))
  return { source, code: compiled.outputText }
}
