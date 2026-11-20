// Hands the generated Redis client members to Monaco as a completion provider. No TypeScript worker is involved:
// the learner files are plain JavaScript, the provider is a small function, and the member list (a JSON file the
// generator wrote) is loaded on the first completion, in a chunk of its own, so opening the editor costs nothing
// extra and the game keeps working offline.
import type * as MonacoApi from 'monaco-editor/editor';
import { completionContext, namespaceNames, suggestionsFor } from './completion';
import type { ClientApi } from './completion';

/** The generated file, loaded on demand. */
export async function loadGeneratedApi(): Promise<ClientApi> {
  const mod = await import('./client-api.generated.json');
  return (mod.default ?? mod) as unknown as ClientApi;
}

/** How many lines before the cursor are read to find the chain (a chained call can span several lines). */
const LOOKBEHIND_LINES = 40;

export function registerClientCompletion(
  monaco: typeof MonacoApi,
  load: () => Promise<ClientApi> = loadGeneratedApi,
): MonacoApi.IDisposable {
  const kinds = {
    method: monaco.languages.CompletionItemKind.Method,
    property: monaco.languages.CompletionItemKind.Property,
    namespace: monaco.languages.CompletionItemKind.Module,
  } as const;
  let loading: Promise<ClientApi | null> | null = null;
  const api = () => (loading ??= load().catch(() => null));
  return monaco.languages.registerCompletionItemProvider(['javascript', 'typescript'], {
    triggerCharacters: ['.'],
    async provideCompletionItems(model, position) {
      const before = model.getValueInRange({
        startLineNumber: Math.max(1, position.lineNumber - LOOKBEHIND_LINES),
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      // Cheap exit before the list is even loaded: nothing here follows a dot.
      if (!/\.\s*[\w$]*$/.test(before)) return { suggestions: [] };
      const list = await api();
      if (!list) return { suggestions: [] };
      const ctx = completionContext(before, namespaceNames(list));
      if (!ctx) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: suggestionsFor(list, ctx.target).map((s) => ({
          label: { label: s.label, detail: s.detail, description: s.description },
          kind: kinds[s.kind],
          insertText: s.insertText,
          insertTextRules: s.snippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          documentation: s.documentation,
          sortText: s.sortText,
          range,
        })),
      };
    },
  });
}
