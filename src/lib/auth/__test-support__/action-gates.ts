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

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

export function actionGates(root: string): Record<string, ActionGate> {
  const result: Record<string, ActionGate> = {};
  for (const file of walk(path.join(root, "src"), [])) {
    const text = readFileSync(file, "utf8");
    if (!text.trimStart().startsWith('"use server"')) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (!isUseServer(source)) continue;

    const locals = new Map<string, ts.FunctionLikeDeclaration>();
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) locals.set(statement.name.text, statement);
      if (ts.isVariableStatement(statement)) {
        for (const d of statement.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) locals.set(d.name.text, d.initializer);
        }
      }
    }

    /** Gates reachable from `fn`; `params` maps a parameter name to the literal it was called with. */
    const gatesOf = (fn: ts.FunctionLikeDeclaration, params: Map<string, string>, seen: Set<ts.Node>): Set<string> => {
      const found = new Set<string>();
      if (seen.has(fn)) return found;
      seen.add(fn);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const name = calleeName(node);
          const first = node.arguments[0];
          if (name && PERMISSION_CALLS.has(name)) {
            const literal = name === "can" || name === "authorize" ? node.arguments[1] : first;
            if (literal && ts.isStringLiteral(literal)) found.add(literal.text);
            else if (literal && ts.isIdentifier(literal) && params.has(literal.text)) found.add(params.get(literal.text)!);
            else found.add(`${name}(?)`);
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
        ts.forEachChild(node, visit);
      };
      if (fn.body) visit(fn.body);
      return found;
    };

    const rel = path.relative(root, file);
    for (const statement of source.statements) {
      const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) continue;
      const fns: [string, ts.FunctionLikeDeclaration][] = [];
      if (ts.isFunctionDeclaration(statement) && statement.name) fns.push([statement.name.text, statement]);
      if (ts.isVariableStatement(statement)) {
        for (const d of statement.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) fns.push([d.name.text, d.initializer]);
        }
      }
      for (const [name, fn] of fns) {
        const gates = [...gatesOf(fn, new Map(), new Set())];
        // "staff" is implied by any named permission.
        const named = gates.filter((g) => g !== "staff").sort();
        result[`${rel}#${name}`] = { gates: named.length > 0 ? named : gates };
      }
    }
  }
  return result;
}
