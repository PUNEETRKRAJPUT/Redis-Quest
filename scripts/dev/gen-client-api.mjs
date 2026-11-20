#!/usr/bin/env node
// Generates ui/src/editor/client-api.generated.json: what the code editor offers after `redis.`, `redis.multi().`,
// `db.` and `log.`. The list is read from the installed library's own type definitions (the TypeScript compiler API,
// already in the workspace), never written by hand. Run it by hand after a node-redis upgrade and commit the output:
//
//   node scripts/dev/gen-client-api.mjs
//
// It only reads type files (node-redis's .d.ts and packages/shared/src/learner/types.ts); it starts nothing and
// writes one file. Deterministic: the same library version gives the same bytes.
//
// Which type is walked: learner code receives `LearnerRedis` (packages/shared/src/learner/types.ts), declared as
// `RedisClientType<any, any, any, any, any>` ("typed loosely on purpose"). The `any` generics erase the members, so
// the walk uses node-redis's own default client type `RedisClientType` (default modules: json, ft, ts, bf, cf, cms,
// topK, tDigest), which is what `createClient()` returns and what deps.ts builds before the cast.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharedDir = path.join(root, 'packages', 'shared');
const outFile = path.join(root, 'ui', 'src', 'editor', 'client-api.generated.json');

// A file that exists only in memory, inside packages/shared so that `redis` resolves the way the shared package sees it.
const probePath = path.join(sharedDir, 'src', '__client_api_probe.ts');
const probeText = `import type { RedisClientType } from 'redis';
import type { LearnerDb, LearnerDeps } from './learner/types.js';
declare const client: RedisClientType;
const chain = client.multi();
export type Client = RedisClientType;
export type Multi = typeof chain;
export type Db = LearnerDb;
export type Log = LearnerDeps['log'];
export type Fn = Function;
`;

const options = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  types: [],
};
const host = ts.createCompilerHost(options);
const isProbe = (f) => path.resolve(f) === probePath;
const baseGetSourceFile = host.getSourceFile.bind(host);
const baseFileExists = host.fileExists.bind(host);
const baseReadFile = host.readFile.bind(host);
host.getSourceFile = (f, lang, ...rest) =>
  isProbe(f) ? ts.createSourceFile(f, probeText, lang, true) : baseGetSourceFile(f, lang, ...rest);
host.fileExists = (f) => isProbe(f) || baseFileExists(f);
host.readFile = (f) => (isProbe(f) ? probeText : baseReadFile(f));

const program = ts.createProgram([probePath], options, host);
const checker = program.getTypeChecker();
const probe = program.getSourceFile(probePath);
if (!probe) throw new Error('the probe file was not created');

const diagnostics = ts.getPreEmitDiagnostics(program, probe);
if (diagnostics.length > 0) {
  for (const d of diagnostics) console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  throw new Error('the probe does not type-check: is the workspace installed (pnpm install)?');
}

function aliasType(name) {
  const decl = probe.statements.find((s) => ts.isTypeAliasDeclaration(s) && s.name.text === name);
  if (!decl) throw new Error(`probe type ${name} not found`);
  return { type: checker.getTypeAtLocation(decl.name), at: decl.name };
}

// ---- formatting -----------------------------------------------------------------------------------------------
const cap = (s, n) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
const tidy = (s) =>
  s
    .replace(/import\("[^"]*"\)\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * node-redis types most commands as one rest parameter that is a tuple (or a union of tuples, one per accepted
 * form): `(...args: [key: RedisArgument, value: ...])`. Unwrap it into the parameters a person types.
 */
function tupleForms(sig, at) {
  const ps = sig.getParameters();
  if (ps.length !== 1) return null;
  const decl = ps[0].valueDeclaration;
  if (!(decl && ts.isParameter(decl) && decl.dotDotDotToken !== undefined)) return null;
  const t = checker.getTypeOfSymbolAtLocation(ps[0], at);
  const alts = t.isUnion() ? t.types : [t];
  const texts = alts.map((a) =>
    tidy(checker.typeToString(a, undefined, ts.TypeFormatFlags.NoTruncation)),
  );
  if (!texts.every((x) => x.startsWith('[') && x.endsWith(']'))) return null;
  return texts.map((x) => x.slice(1, -1));
}

/** `(key: RedisArgument, value: ...)` and the return type, split so the list stays small. */
function describe(sig, at) {
  const forms = tupleForms(sig, at);
  if (forms) {
    return {
      params: `(${cap(forms[0], 220)})`,
      returns: cap(niceReturn(tidy(checker.typeToString(sig.getReturnType()))), 70),
      ...(forms.length > 1 ? { forms: forms.slice(0, 4).map((f) => `(${cap(f, 160)})`) } : {}),
    };
  }
  const params = sig
    .getParameters()
    .filter((p) => p.getName() !== 'this')
    .map((p) => {
      const decl = p.valueDeclaration;
      const rest = decl && ts.isParameter(decl) && decl.dotDotDotToken !== undefined;
      const optional =
        (p.flags & ts.SymbolFlags.Optional) !== 0 ||
        (decl && ts.isParameter(decl) && decl.questionToken !== undefined);
      const t = tidy(checker.typeToString(checker.getTypeOfSymbolAtLocation(p, at)));
      return `${rest ? '...' : ''}${p.getName()}${optional ? '?' : ''}: ${cap(t, 90)}`;
    });
  const returns = cap(niceReturn(tidy(checker.typeToString(sig.getReturnType()))), 70);
  return { params: `(${params.join(', ')})`, returns };
}

/** The multi chain's type is a screenful of generics; the learner only needs to know it is the chain. */
const niceReturn = (t) =>
  /InternalRedisClientMultiCommandType|TypedOrAny/.test(t) ? 'the multi chain' : t;

const NAMESPACE_MIN_METHODS = 3;
const isMemberName = (n) => /^[a-z][A-Za-z0-9]*$/.test(n);

/**
 * The public members of `type`: lower-case-initial names only. node-redis exposes every command twice (`SET` and
 * `set`); the camelCase one is what the docs use, so the upper-case twin is left out of the list.
 */
function membersOf(type, at, { namespaces = true } = {}) {
  const out = [];
  for (const sym of checker.getPropertiesOfType(type)) {
    const name = sym.getName();
    if (!isMemberName(name)) continue;
    const t = checker.getTypeOfSymbolAtLocation(sym, at);
    const sigs = t.getCallSignatures();
    const doc = cap(tidy(ts.displayPartsToString(sym.getDocumentationComment(checker))), 240);
    if (sigs.length > 0) {
      const { params, returns, forms } = describe(sigs[0], at);
      out.push({
        name,
        kind: 'method',
        params,
        returns,
        ...(forms ? { forms } : {}),
        ...(sigs.length > 1 ? { overloads: sigs.length } : {}),
        ...(doc ? { doc } : {}),
      });
      continue;
    }
    // Only an object type can be a namespace (a number's apparent members must not turn `socketEpoch` into one).
    const props =
      t.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)
        ? checker.getPropertiesOfType(t)
        : [];
    const callable = props.filter(
      (p) => checker.getTypeOfSymbolAtLocation(p, at).getCallSignatures().length > 0,
    );
    if (namespaces && callable.length >= NAMESPACE_MIN_METHODS) {
      out.push({ name, kind: 'namespace', members: membersOf(t, at, { namespaces: false }) });
      continue;
    }
    out.push({
      name,
      kind: 'property',
      type: cap(tidy(checker.typeToString(t)), 90),
      ...(doc ? { doc } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

// ---- the four lists ---------------------------------------------------------------------------------------------
const client = aliasType('Client');
const multi = aliasType('Multi');
const db = aliasType('Db');
const log = aliasType('Log');
const fn = aliasType('Fn');

const redisMembers = membersOf(client.type, client.at);
const multiMembers = membersOf(multi.type, multi.at);

// `redis.multi().set(...)` has the client's command parameters but returns the chain itself. Store only what the
// chain adds (exec, execAsPipeline, ...) and the names it shares with the client, so the file holds each signature once.
const clientByName = new Map(redisMembers.map((m) => [m.name, m]));
const shared = [];
const only = [];
for (const m of multiMembers) {
  const twin = clientByName.get(m.name);
  if (twin && twin.kind === m.kind && (m.kind === 'method' || m.kind === 'namespace'))
    shared.push(m.name);
  else only.push(m);
}

// `log` is a function, so what follows `log.` is the members every function has (apply, bind, call ...), read from
// the standard library's own `Function` type.
const logSig = checker.getSignaturesOfType(log.type, ts.SignatureKind.Call)[0];
const logMembers = membersOf(fn.type, fn.at, { namespaces: false });

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const redisPkgDir = fs.realpathSync(path.join(sharedDir, 'node_modules', 'redis'));
const redisPkg = readJson(path.join(redisPkgDir, 'package.json'));
const clientPkg = readJson(
  path.join(path.dirname(redisPkgDir), '@redis', 'client', 'package.json'),
);

const result = {
  generatedBy: 'scripts/dev/gen-client-api.mjs',
  source: {
    library: 'redis',
    version: redisPkg.version,
    clientLibrary: '@redis/client',
    clientVersion: clientPkg.version,
    typescript: ts.version,
    walked:
      "RedisClientType (node-redis's default client type; LearnerRedis uses `any` generics, which hide members)",
  },
  redis: redisMembers,
  multi: { shared, only },
  db: membersOf(db.type, db.at, { namespaces: false }),
  log: {
    call: logSig ? describe(logSig, log.at) : null,
    members: logMembers,
  },
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${JSON.stringify(result, null, 1)}\n`);
console.log(
  `wrote ${path.relative(root, outFile)}: redis ${redisMembers.length} members (${redisMembers
    .filter((m) => m.kind === 'namespace')
    .map((m) => m.name)
    .join(', ')}), ` +
    `multi ${shared.length} shared + ${only.length} own, db ${result.db.length}, log ${logMembers.length}; ` +
    `redis@${redisPkg.version}, @redis/client@${clientPkg.version}`,
);
