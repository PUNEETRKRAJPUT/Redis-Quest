import { entryPath } from './logic';

/** How to turn an attempt into a pull request. Plain steps and one file path: nothing here leaves the page. */
export function Submit({ holeId, entry }: { holeId: string; entry: string }) {
  const body = entry.trim() === '' ? '# your commands, one per line\n' : `${entry.trimEnd()}\n`;
  return (
    <ol className="m-0 list-decimal space-y-2 pl-5 text-md text-chalk" data-testid="league-submit">
      <li>
        Create the file{' '}
        <code className="rounded-xs bg-night-950 px-1.5 py-0.5 font-mono text-sm text-flood-400">
          {entryPath(holeId)}
        </code>
        . The file name is your GitHub handle.
      </li>
      <li>Paste your entry into it. One command per line; a line starting with # is a comment.</li>
      <li>
        Open a pull request that touches only that file. A check called <strong>league</strong> runs
        your entry on a fresh Redis and fails the pull request if a hole check fails.
      </li>
      <li>When it is green and merged, your row is on the board.</li>
      <li>
        <span className="text-chalk-dim">The file as it would be committed:</span>
        <pre
          className="m-0 mt-1.5 overflow-x-auto rounded-md border border-night-600/60 bg-night-950/80 p-3 font-mono text-sm text-chalk"
          data-testid="league-file"
        >
          {body}
        </pre>
      </li>
    </ol>
  );
}
