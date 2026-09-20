/**
 * Reads every "use server" module's syntax tree and reports, per exported
 * action, the permissions it checks before doing anything — following calls
 * into functions declared in the same file (the `authorise(...)` helpers).
 * Used by permission-gates.test.ts. Test support only: no runtime import.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Calls that authorize: the permission is their first string argument. */
const PERMISSION_CALLS = new Set(["requirePermission", "staffCan", "can", "authorize"]);
/**
 * Calls whose RESULT is the decision: a bare `can(roles, "x");` statement that
 * throws the answer away gates nothing. (`requirePermission` throws on refusal, so a bare
 * `await requirePermission(...)` statement is exactly how it is meant to be used.)
 */
const DECISION_CALLS = new Set(["staffCan", "can", "authorize"]);
/** Calls that only authenticate a staff member, with no permission named. */
const STAFF_CALLS = new Set(["requireStaff", "getStaff"]);

export interface ActionGate {
  /** Permissions named, sorted; "staff" when only a signed-in staff member is required. */
  readonly gates: readonly string[];
}

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function isUseServer(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return first !== undefined && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
}

/**
 * Gates for ONE source text. Exported for the extractor's own tests.
 *
 * The rules are deliberately strict, because this is a test that must fail when
 * a gate is removed or made ineffective:
 * - the directive is read from the syntax tree, so a comment above `"use server"` does not hide a file;
 * - only a plain call by name counts (`obj.can(...)` and shadowed names do not);
 * - a gate inside a branch that may not run (an `if` body, `cond && gate()`, a `?:` arm, a loop, a `catch`, a
 *   `switch` case) does not count: an action is gated only by what runs on every call;
 * - a decision call whose result is thrown away does not count;
 * - an export form the extractor cannot follow (`export default`, `export { a }`, `export const a = wrap(...)`)
 *   is an error, never silently skipped.
 */
export function gatesOfSource(text: string, label: string): Record<string, ActionGate> {
  const result: Record<string, ActionGate> = {};
  const source = ts.createSourceFile(label, text, ts.ScriptTarget.Latest, true);
  if (!isUseServer(source)) return result;

  const locals = new Map<string, ts.FunctionLikeDeclaration>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) locals.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) locals.set(d.name.text, d.initializer);
      }
    }
  }

  /** Gates reachable from `fn` on every call; `params` maps a parameter name to the literal it was called with. */
  const gatesOf = (fn: ts.FunctionLikeDeclaration, params: Map<string, string>, seen: Set<ts.Node>): Set<string> => {
    const found = new Set<string>();
    if (seen.has(fn)) return found;
    seen.add(fn);
    const visit = (node: ts.Node, conditional: boolean) => {
      // Nested functions are not run by the action itself.
      if (node !== fn.body && (ts.isFunctionLike(node))) return;
      if (ts.isCallExpression(node) && !conditional) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : null;
        const first = node.arguments[0];
        if (name && PERMISSION_CALLS.has(name)) {
          let outer: ts.Node = node;
          while (outer.parent && (ts.isAwaitExpression(outer.parent) || ts.isParenthesizedExpression(outer.parent))) outer = outer.parent;
          const discarded = DECISION_CALLS.has(name) && outer.parent !== undefined && (ts.isExpressionStatement(outer.parent) || ts.isVoidExpression(outer.parent));
          if (!discarded) {
            const literal = name === "can" || name === "authorize" ? node.arguments[1] : first;
            if (literal && ts.isStringLiteral(literal)) found.add(literal.text);
            else if (literal && ts.isIdentifier(literal) && params.has(literal.text)) found.add(params.get(literal.text)!);
            else found.add(`${name}(?)`);
          }
        } else if (name && STAFF_CALLS.has(name)) {
          found.add("staff");
        } else if (name && locals.has(name)) {
          const target = locals.get(name)!;
          // A helper called with a literal, or a choice of two literals
          // (`kind === "DUPLICATE" ? "orders.refund" : "orders.create"`), is
          // followed once per literal it can receive.
          const choices = target.parameters.map((p, i) => {
            const a = node.arguments[i];
            if (!ts.isIdentifier(p.name) || !a) return null;
            if (ts.isStringLiteral(a)) return [p.name.text, [a.text]] as const;
            if (ts.isConditionalExpression(a) && ts.isStringLiteral(a.whenTrue) && ts.isStringLiteral(a.whenFalse)) return [p.name.text, [a.whenTrue.text, a.whenFalse.text]] as const;
            return null;
          });
          const variants = choices.reduce<Map<string, string>[]>(
            (acc, choice) => (choice ? acc.flatMap((m) => choice[1].map((value) => new Map([...m, [choice[0], value]]))) : acc),
            [new Map()],
          );
          for (const params of variants) for (const g of gatesOf(target, params, new Set(seen))) found.add(g);
        }
      }
      // Which children run on every call, and which only sometimes.
      if (ts.isIfStatement(node)) {
        visit(node.expression, conditional);
        visit(node.thenStatement, true);
        if (node.elseStatement) visit(node.elseStatement, true);
        return;
      }
      if (ts.isConditionalExpression(node)) {
        visit(node.condition, conditional);
        visit(node.whenTrue, true);
        visit(node.whenFalse, true);
        return;
      }
      if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
        visit(node.left, conditional);
        visit(node.right, true);
        return;
      }
      if (ts.isTryStatement(node)) {
        visit(node.tryBlock, conditional);
        if (node.catchClause) visit(node.catchClause, true);
        if (node.finallyBlock) visit(node.finallyBlock, conditional);
        return;
      }
      if (ts.isSwitchStatement(node)) {
        visit(node.expression, conditional);
        for (const clause of node.caseBlock.clauses) visit(clause, true);
        return;
      }
      if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
        ts.forEachChild(node, (child) => visit(child, true));
        return;
      }
      ts.forEachChild(node, (child) => visit(child, conditional));
    };
    if (fn.body) visit(fn.body, false);
    return found;
  };

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) throw new Error(`${label}: "export default" in a "use server" file cannot be followed by the permission-gate test`);
    if (ts.isExportAssignment(statement)) throw new Error(`${label}: "export default" in a "use server" file cannot be followed by the permission-gate test`);
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) throw new Error(`${label}: "export { ... }" in a "use server" file cannot be followed by the permission-gate test`);
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    const fns: [string, ts.FunctionLikeDeclaration][] = [];
    if (ts.isFunctionDeclaration(statement) && statement.name) fns.push([statement.name.text, statement]);
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) fns.push([d.name.text, d.initializer]);
        else throw new Error(`${label}: exported "${d.name.getText(source)}" is not a plain function; the permission-gate test cannot follow it`);
      }
    }
    for (const [name, fn] of fns) {
      const gates = [...gatesOf(fn, new Map(), new Set())];
      // "staff" is implied by any named permission.
      const named = gates.filter((g) => g !== "staff").sort();
      result[`${label}#${name}`] = { gates: named.length > 0 ? named : gates };
    }
  }
  return result;
}

export function actionGates(root: string): Record<string, ActionGate> {
  const result: Record<string, ActionGate> = {};
  for (const file of walk(path.join(root, "src"), [])) {
    // No text pre-filter: the directive is read from the syntax tree (a comment above it must not hide the file).
    Object.assign(result, gatesOfSource(readFileSync(file, "utf8"), path.relative(root, file)));
  }
  return result;
}
