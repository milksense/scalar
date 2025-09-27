import fs from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

const INDENT = '  '

function getStringLiteral(arg: ts.Expression): string | undefined {
  if (ts.isStringLiteral(arg)) {
    return arg.text
  }
  return undefined
}

function ensureTsExtension(resolvedPath: string): string {
  const ext = path.extname(resolvedPath)
  if (ext) {
    return resolvedPath
  }
  const tsPath = `${resolvedPath}.ts`
  if (fs.existsSync(tsPath)) {
    return tsPath
  }
  return tsPath
}

function resolveAliasPath(p: string, baseDir?: string): string {
  if (p.startsWith('@/')) {
    const primaryBase = path.resolve(process.cwd(), 'src', p.slice(2))
    const primary = ensureTsExtension(primaryBase)
    if (fs.existsSync(primary)) {
      return primary
    }
    const fallbackBase = path.resolve(process.cwd(), 'packages', 'workspace-store', 'src', p.slice(2))
    const fallback = ensureTsExtension(fallbackBase)
    return fallback
  }
  if (p.startsWith('./') || p.startsWith('../')) {
    const base = baseDir ?? process.cwd()
    const relativeBase = path.resolve(base, p)
    return ensureTsExtension(relativeBase)
  }
  const absoluteBase = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
  return ensureTsExtension(absoluteBase)
}

function getLastJSDocCommentForNode(
  source: ts.SourceFile,
  node: ts.Node,
  which: 'first' | 'last' = 'last',
): string | undefined {
  const fullText = source.getFullText()
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart()) || []
  const jsDocRanges = ranges.filter((r) => fullText.slice(r.pos, r.end).startsWith('/**'))
  if (jsDocRanges.length === 0) {
    return undefined
  }
  const selectedRange = which === 'first' ? jsDocRanges[0]! : jsDocRanges[jsDocRanges.length - 1]!
  const commentText = fullText.slice(selectedRange.pos, selectedRange.end).trim()
  return commentText
}

function getIdentifierText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name)) {
    return name.text
  }
  if (ts.isStringLiteral(name)) {
    return name.text
  }
  if (ts.isNumericLiteral(name)) {
    return name.text
  }
  return undefined
}

function findVariableDeclaration(source: ts.SourceFile, variableName: string): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) {
      found = node
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function findModuleMap(source: ts.SourceFile): Map<string, string> | undefined {
  const moduleDecl = findVariableDeclaration(source, 'module')
  if (!moduleDecl || !moduleDecl.initializer) return undefined
  if (!ts.isCallExpression(moduleDecl.initializer)) return undefined
  const call = moduleDecl.initializer
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined
  if (call.expression.expression.getText() !== 'Type' || call.expression.name.getText() !== 'Module') return undefined
  if (call.arguments.length === 0) return undefined
  let arg = call.arguments[0]!
  if (ts.isSatisfiesExpression(arg)) {
    arg = arg.expression
  }
  if (!ts.isObjectLiteralExpression(arg)) return undefined

  const map = new Map<string, string>()
  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue

    let keyName: string | undefined
    if (ts.isStringLiteral(prop.name)) {
      keyName = prop.name.text
    } else if (ts.isComputedPropertyName(prop.name)) {
      const expr = prop.name.expression
      // Expecting [REF_DEFINITIONS.X]
      if (ts.isPropertyAccessExpression(expr)) {
        keyName = expr.name.getText()
      }
    } else if (ts.isIdentifier(prop.name)) {
      keyName = prop.name.text
    }

    if (!keyName) continue

    if (ts.isIdentifier(prop.initializer)) {
      map.set(keyName, prop.initializer.text)
    }
  }
  return map
}

function findImportPathForIdentifier(source: ts.SourceFile, identifierName: string): string | undefined {
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause || !stmt.moduleSpecifier) continue
    const { importClause } = stmt
    if (!importClause.namedBindings || !ts.isNamedImports(importClause.namedBindings)) continue
    const named = importClause.namedBindings
    for (const el of named.elements) {
      const importedName = (el.propertyName ?? el.name).text
      if (importedName === identifierName) {
        if (ts.isStringLiteral(stmt.moduleSpecifier)) {
          return stmt.moduleSpecifier.text
        }
      }
    }
  }
  return undefined
}

function buildInlineObjectType(
  source: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  aliasBaseToTypeName: Map<string, string>,
): string {
  const pieces: string[] = []
  pieces.push('{')
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const nameText = getIdentifierText(prop.name)
    if (!nameText) continue
    const inferred = getTypeFromTypeboxExpression(prop.initializer, source, aliasBaseToTypeName)
    if (!inferred) continue
    const optionalMark = inferred.optional ? '?' : ''
    pieces.push(`${INDENT}${nameText}${optionalMark}: ${inferred.type}`)
  }
  pieces.push('}')
  return pieces.join('\n')
}

function getTypeFromTypeboxExpression(
  expr: ts.Expression,
  source: ts.SourceFile,
  aliasBaseToTypeName: Map<string, string>,
): { type: string; optional: boolean } | undefined {
  // Handle Type.Optional(X)
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    const outerProp = expr.expression
    const outerName = outerProp.name.getText()
    const outerExprText = outerProp.expression.getText()

    if (outerExprText === 'Type' && outerName === 'Optional' && expr.arguments.length === 1) {
      const inner = expr.arguments[0]!
      const innerType = getTypeFromTypeboxExpression(inner, source, aliasBaseToTypeName)
      if (!innerType) {
        return undefined
      }
      return { type: innerType.type, optional: true }
    }

    // Handle Type.Array(X)
    if (outerExprText === 'Type' && outerName === 'Array' && expr.arguments.length === 1) {
      const inner = expr.arguments[0]!
      // Inline object
      if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression)) {
        const innerProp = inner.expression
        if (
          innerProp.expression.getText() === 'Type' &&
          innerProp.name.getText() === 'Object' &&
          inner.arguments.length > 0
        ) {
          const arg0 = inner.arguments[0]!
          if (ts.isObjectLiteralExpression(arg0)) {
            const inline = buildInlineObjectType(source, arg0, aliasBaseToTypeName)
            return { type: `${inline}[]`, optional: false }
          }
        }
      }
      const innerType = getTypeFromTypeboxExpression(inner, source, aliasBaseToTypeName)
      if (!innerType) return undefined
      return { type: `${innerType.type}[]`, optional: false }
    }

    // Handle primitives like Type.String()
    if (outerExprText === 'Type') {
      switch (outerName) {
        case 'String':
          return { type: 'string', optional: false }
        case 'Number':
          return { type: 'number', optional: false }
        case 'Boolean':
          return { type: 'boolean', optional: false }
        case 'Null':
          return { type: 'null', optional: false }
        case 'Object': {
          // Inline object type (non-array)
          if (expr.arguments.length > 0 && ts.isObjectLiteralExpression(expr.arguments[0]!)) {
            const inline = buildInlineObjectType(
              source,
              expr.arguments[0] as ts.ObjectLiteralExpression,
              aliasBaseToTypeName,
            )
            return { type: inline, optional: false }
          }
          break
        }
      }
    }
  }

  // Handle identifiers like ContactObjectRef
  if (ts.isIdentifier(expr)) {
    const idName = expr.text
    if (idName.endsWith('Ref')) {
      const base = idName.slice(0, -3)
      const mapped = aliasBaseToTypeName.get(base) ?? base
      return { type: mapped, optional: false }
    }
  }

  return undefined
}

function isComposeCall(expr: ts.Expression): expr is ts.CallExpression {
  return ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'compose'
}

export const generateTypeFromSchema = (filename: string, schemaTypeMap: Map<string, string>): string => {
  const filePath = resolveAliasPath(filename)
  const sourceText = fs.readFileSync(filePath, 'utf8')
  const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  // Build an index of all variable declarations that are Type.Object(..)
  const schemaDecls = new Map<
    string,
    { objects: ts.ObjectLiteralExpression[]; statement?: ts.VariableStatement; source: ts.SourceFile }
  >()

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      // Direct Type.Object(...)
      if (
        ts.isCallExpression(node.initializer) &&
        ts.isPropertyAccessExpression(node.initializer.expression) &&
        node.initializer.expression.expression.getText() === 'Type' &&
        node.initializer.expression.name.getText() === 'Object' &&
        node.initializer.arguments.length > 0 &&
        ts.isObjectLiteralExpression(node.initializer.arguments[0]!)
      ) {
        const object = node.initializer.arguments[0] as ts.ObjectLiteralExpression
        const maybeStatement = node.parent?.parent
        const statement = maybeStatement && ts.isVariableStatement(maybeStatement) ? maybeStatement : undefined
        schemaDecls.set(node.name.text, { objects: [object], statement, source })
      }

      // compose(Type.Object(...), ...)
      if (isComposeCall(node.initializer)) {
        const objects: ts.ObjectLiteralExpression[] = []
        for (const arg of node.initializer.arguments) {
          // Inline Type.Object
          if (
            ts.isCallExpression(arg) &&
            ts.isPropertyAccessExpression(arg.expression) &&
            arg.expression.expression.getText() === 'Type' &&
            arg.expression.name.getText() === 'Object' &&
            arg.arguments.length > 0 &&
            ts.isObjectLiteralExpression(arg.arguments[0]!)
          ) {
            objects.push(arg.arguments[0] as ts.ObjectLiteralExpression)
            continue
          }
          // Identifier referencing a variable in this file or imported
          if (ts.isIdentifier(arg)) {
            const idDecl = findVariableDeclaration(source, arg.text)
            const pushFromDecl = (decl: ts.VariableDeclaration) => {
              if (
                decl.initializer &&
                ts.isCallExpression(decl.initializer) &&
                ts.isPropertyAccessExpression(decl.initializer.expression) &&
                decl.initializer.expression.expression.getText() === 'Type' &&
                decl.initializer.expression.name.getText() === 'Object' &&
                decl.initializer.arguments.length > 0 &&
                ts.isObjectLiteralExpression(decl.initializer.arguments[0]!)
              ) {
                objects.push(decl.initializer.arguments[0] as ts.ObjectLiteralExpression)
              }
            }
            if (idDecl) {
              pushFromDecl(idDecl)
            } else {
              const importPath = findImportPathForIdentifier(source, arg.text)
              if (importPath) {
                const resolvedImportPath = resolveAliasPath(importPath, path.dirname(source.fileName))
                const importedText = fs.readFileSync(resolvedImportPath, 'utf8')
                const importedSource = ts.createSourceFile(
                  resolvedImportPath,
                  importedText,
                  ts.ScriptTarget.Latest,
                  true,
                  ts.ScriptKind.TS,
                )
                let found: ts.VariableDeclaration | undefined
                const visitImported = (n: ts.Node) => {
                  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === arg.text) {
                    found = n
                    return
                  }
                  ts.forEachChild(n, visitImported)
                }
                visitImported(importedSource)
                if (found) pushFromDecl(found)
              }
            }
          }
        }
        if (objects.length > 0) {
          const maybeStatement = node.parent?.parent
          const statement = maybeStatement && ts.isVariableStatement(maybeStatement) ? maybeStatement : undefined
          schemaDecls.set(node.name.text, { objects, statement, source })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  const lines: string[] = []
  // Map for alias resolution (e.g., ContactObjectRef -> ContactObject)
  const aliasBaseToTypeName = new Map<string, string>()
  for (const [schemaName, typeName] of schemaTypeMap.entries()) {
    const baseFromSchema = schemaName.replace(/Schema(Definition)?$/, '')
    aliasBaseToTypeName.set(baseFromSchema, typeName)
    aliasBaseToTypeName.set(typeName, typeName)
  }

  const moduleMap = findModuleMap(source)

  for (const [schemaName, typeName] of schemaTypeMap.entries()) {
    let decl = schemaDecls.get(schemaName)
    let declSource: ts.SourceFile = source

    // If not found locally as Type.Object, try resolving module.Import('...') indirection
    if (!decl) {
      const schemaVar = findVariableDeclaration(source, schemaName)
      const isModuleImport =
        schemaVar?.initializer &&
        ts.isCallExpression(schemaVar.initializer) &&
        ts.isPropertyAccessExpression(schemaVar.initializer.expression) &&
        schemaVar.initializer.expression.expression.getText() === 'module' &&
        schemaVar.initializer.expression.name.getText() === 'Import' &&
        schemaVar.initializer.arguments.length === 1

      if (isModuleImport) {
        const callInit = schemaVar!.initializer as ts.CallExpression
        const importKey = getStringLiteral(callInit.arguments[0]!)
        if (!importKey) {
          throw new Error(`Schema ${schemaName} is a module.Import but key is not a string in ${filename}`)
        }
        if (!moduleMap) {
          throw new Error(`Could not find Type.Module definition to resolve ${importKey} in ${filename}`)
        }
        const defIdentifier = moduleMap.get(importKey)
        if (!defIdentifier) {
          throw new Error(`Could not resolve definition for ${importKey} from Type.Module in ${filename}`)
        }

        // Try to find the definition in this file first
        const localDef = schemaDecls.get(defIdentifier)
        if (localDef) {
          decl = localDef
          declSource = localDef.source
        } else {
          // Resolve via import
          const importPath = findImportPathForIdentifier(source, defIdentifier)
          if (!importPath) {
            throw new Error(`Could not find import path for ${defIdentifier} in ${filename}`)
          }
          const resolvedImportPath = resolveAliasPath(importPath, path.dirname(source.fileName))
          const importedText = fs.readFileSync(resolvedImportPath, 'utf8')
          const importedSource = ts.createSourceFile(
            resolvedImportPath,
            importedText,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS,
          )

          // Find the variable declaration in imported file
          let importedDecl:
            | { objects: ts.ObjectLiteralExpression[]; statement?: ts.VariableStatement; source: ts.SourceFile }
            | undefined
          const visitImported = (node: ts.Node) => {
            if (
              ts.isVariableDeclaration(node) &&
              ts.isIdentifier(node.name) &&
              node.name.text === defIdentifier &&
              node.initializer
            ) {
              const maybeStatement = node.parent?.parent
              const statement = maybeStatement && ts.isVariableStatement(maybeStatement) ? maybeStatement : undefined
              if (
                ts.isCallExpression(node.initializer) &&
                ts.isPropertyAccessExpression(node.initializer.expression) &&
                node.initializer.expression.expression.getText() === 'Type' &&
                node.initializer.expression.name.getText() === 'Object' &&
                node.initializer.arguments.length > 0 &&
                ts.isObjectLiteralExpression(node.initializer.arguments[0]!)
              ) {
                const object = node.initializer.arguments[0] as ts.ObjectLiteralExpression
                importedDecl = { objects: [object], statement, source: importedSource }
                return
              }
              if (isComposeCall(node.initializer)) {
                const objects: ts.ObjectLiteralExpression[] = []
                for (const arg of node.initializer.arguments) {
                  if (
                    ts.isCallExpression(arg) &&
                    ts.isPropertyAccessExpression(arg.expression) &&
                    arg.expression.expression.getText() === 'Type' &&
                    arg.expression.name.getText() === 'Object' &&
                    arg.arguments.length > 0 &&
                    ts.isObjectLiteralExpression(arg.arguments[0]!)
                  ) {
                    objects.push(arg.arguments[0] as ts.ObjectLiteralExpression)
                    continue
                  }
                  if (ts.isIdentifier(arg)) {
                    let innerDecl: ts.VariableDeclaration | undefined
                    const seek = (n: ts.Node) => {
                      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === arg.text) {
                        innerDecl = n
                        return
                      }
                      ts.forEachChild(n, seek)
                    }
                    seek(importedSource)
                    const pushFromDecl = (declNode: ts.VariableDeclaration) => {
                      if (
                        declNode.initializer &&
                        ts.isCallExpression(declNode.initializer) &&
                        ts.isPropertyAccessExpression(declNode.initializer.expression) &&
                        declNode.initializer.expression.expression.getText() === 'Type' &&
                        declNode.initializer.expression.name.getText() === 'Object' &&
                        declNode.initializer.arguments.length > 0 &&
                        ts.isObjectLiteralExpression(declNode.initializer.arguments[0]!)
                      ) {
                        objects.push(declNode.initializer.arguments[0] as ts.ObjectLiteralExpression)
                      }
                    }
                    if (innerDecl) {
                      pushFromDecl(innerDecl)
                    } else {
                      const innerImportPath = findImportPathForIdentifier(importedSource, arg.text)
                      if (innerImportPath) {
                        const innerResolvedPath = resolveAliasPath(
                          innerImportPath,
                          path.dirname(importedSource.fileName),
                        )
                        const innerText = fs.readFileSync(innerResolvedPath, 'utf8')
                        const innerSource = ts.createSourceFile(
                          innerResolvedPath,
                          innerText,
                          ts.ScriptTarget.Latest,
                          true,
                          ts.ScriptKind.TS,
                        )
                        let innerFound: ts.VariableDeclaration | undefined
                        const visitInner = (n: ts.Node) => {
                          if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === arg.text) {
                            innerFound = n
                            return
                          }
                          ts.forEachChild(n, visitInner)
                        }
                        visitInner(innerSource)
                        if (innerFound) pushFromDecl(innerFound)
                      }
                    }
                  }
                }
                if (objects.length > 0) {
                  importedDecl = { objects, statement, source: importedSource }
                  return
                }
              }
            }
            ts.forEachChild(node, visitImported)
          }
          visitImported(importedSource)

          if (!importedDecl) {
            throw new Error(`Definition ${defIdentifier} in ${resolvedImportPath} is not a Type.Object`)
          }

          // Use the declaration found in imported file
          decl = importedDecl
          declSource = importedSource

          // Also override the source for JSDoc extraction when needed
          // We will pass along the specific statement's source when available
          // by capturing statement from importedDecl below.

          // Continue with generation using decl
        }
      }
    }

    if (!decl) {
      throw new Error(`Schema ${schemaName} not found or not a Type.Object in ${filename}`)
    }

    const { objects, statement } = decl

    if (statement) {
      const schemaJsDoc = getLastJSDocCommentForNode(declSource, statement, 'first')
      if (schemaJsDoc) {
        lines.push(schemaJsDoc)
      }
    }

    lines.push(`export type ${typeName} = {`)

    for (const prop of objects.flatMap((o) => o.properties)) {
      if (!ts.isPropertyAssignment(prop)) {
        continue
      }
      const nameText = getIdentifierText(prop.name)
      if (!nameText) {
        continue
      }
      const inferred = getTypeFromTypeboxExpression(prop.initializer, declSource, aliasBaseToTypeName)
      if (!inferred) {
        continue
      }

      const jsDoc = getLastJSDocCommentForNode(declSource, prop)
      if (jsDoc) {
        lines.push(`${INDENT}${jsDoc}`)
      }
      const optionalMark = inferred.optional ? '?' : ''
      lines.push(`${INDENT}${nameText}${optionalMark}: ${inferred.type}`)
    }

    lines.push('}')
  }

  const output = lines.join('\n')
  return output
}
