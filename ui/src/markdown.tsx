'use client';

import clsx from 'clsx';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import { Terminal as TerminalIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { play, toast } from '@/design';
import { IconCheck, IconCopy } from './icons';
import { sendToTerminal } from './terminal/bus';
import { docsStore } from './terminal/docs';
import { useDocsVersion } from './terminal/useDocs';
import styles from './terminal/markdown.module.css';

// A small Redis grammar: command words, replies like (integer) 3, strings, numbers and # comments.
hljs.registerLanguage('redis', () => ({
  name: 'redis',
  case_insensitive: false,
  contains: [
    { className: 'comment', begin: /(^|\s)#/, end: /$/ },
    { className: 'meta', begin: /^\((?:integer|nil|error|empty array|double)\)/m, end: /(?=\s|$)/ },
    { className: 'keyword', begin: /^[A-Z][A-Z.]+(?:\s+[A-Z]{2,}\b)?(?=\s|$)/m },
    {
      className: 'keyword',
      begin:
        /\b(?:EX|PX|NX|XX|GT|LT|KEEPTTL|WITHSCORES|REV|COUNT|MATCH|BYLEX|BYSCORE|LIMIT|MAXLEN|BLOCK|STREAMS)\b/,
    },
    { className: 'string', begin: /"/, end: /"/, contains: [{ begin: /\\./ }] },
    { className: 'string', begin: /'/, end: /'/ },
    { className: 'number', begin: /\b-?\d+(?:\.\d+)?\b/ },
  ],
}));
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerAliases(['js', 'mjs'], { languageName: 'javascript' });
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });

export function highlight(code: string, lang: string | undefined): { html: string; lang: string } {
  let l = lang && hljs.getLanguage(lang) ? lang : undefined;
  // An unlabelled block that starts with an upper-case word is almost always a Redis session in this game.
  if (!l && !lang && /^[A-Z]{2,}[A-Z.]*(\s|$)/.test(code.trim())) l = 'redis';
  if (!l) return { html: escapeHtml(code), lang: lang ?? 'text' };
  return { html: hljs.highlight(code, { language: l, ignoreIllegals: true }).value, lang: l };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The text to send for one line of lesson code, or null when it is not a Redis command. A command is a word the
 * running Redis lists (see terminal/docs.ts); with no list yet (the engine cannot supply one, Redis is down) nothing
 * is clickable. A leading prompt (`redis> `, `127.0.0.1:6379> `) is dropped.
 */
export function commandToSend(line: string, has: (name: string) => boolean): string | null {
  const text = line.replace(/^\s*(?:[\w.-]+(?::\d+)?)>\s+/, '').trim();
  const m = /^([A-Za-z][\w-]*)(?=\s|$)/.exec(text);
  if (!m || text.startsWith('#')) return null;
  return has((m[1] as string).toLowerCase()) ? text : null;
}

/** A line of lesson code that is known to be a command, and so a click target. */
function useCommandCheck(): (line: string) => string | null {
  useDocsVersion();
  const store = docsStore();
  useEffect(() => {
    store.ensureNames();
  }, [store]);
  return (line) => (store.names() ? commandToSend(line, (n) => store.has(n)) : null);
}

/** Puts the command on the terminal's line (never runs it); with no terminal open, copies it. */
function SendButton({ text, className, top }: { text: string; className?: string; top?: number }) {
  const [sent, setSent] = useState(false);
  return (
    <button
      type="button"
      className={clsx(styles.send, sent && styles.sent, className)}
      style={top === undefined ? undefined : { top }}
      aria-label={`Send ${text} to the terminal`}
      title="Send to terminal (does not run it)"
      onClick={() => {
        void sendToTerminal(text).then((r) => {
          if (r === 'terminal') play('tick');
          if (r === 'clipboard')
            toast({ title: 'Copied', description: 'No terminal is open. Paste it into one.' });
          if (r === 'failed')
            toast.error('Could not send it', 'Select the text and copy it by hand.');
          if (r === 'terminal' || r === 'queued') {
            setSent(true);
            setTimeout(() => setSent(false), 1200);
          }
        });
      }}
    >
      {sent ? <IconCheck size={12} /> : <TerminalIcon size={12} aria-hidden />}
    </button>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  const check = useCommandCheck();
  const text = String(children ?? '');
  const send = text.includes('\n') ? null : check(text);
  const code = <code className={clsx('inline-code', styles.inline)}>{children}</code>;
  if (!send) return code;
  // The button floats over the top-right corner and reserves no space, so nothing around the code moves.
  return (
    <span className={styles.cmd}>
      {code}
      <SendButton text={send} />
    </span>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const check = useCommandCheck();
  const h = highlight(code, lang);
  const sendable =
    h.lang === 'redis' ? code.split('\n').map((line, i) => ({ i, send: check(line) })) : [];
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div className="codeblock" data-night="">
      <div className={clsx('codeblock-bar', styles.bar)}>
        <span>{h.lang}</span>
        <button type="button" className={styles.copy} onClick={copy} aria-label="Copy code">
          {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <div className={styles.body}>
        <pre className={styles.pre}>
          <code
            className={`hljs language-${h.lang}`}
            dangerouslySetInnerHTML={{ __html: h.html }}
          />
        </pre>
        {sendable.some((l) => l.send) ? (
          <div className={styles.lineActions}>
            {sendable.map((l) =>
              l.send ? (
                <SendButton key={l.i} text={l.send} className={styles.lineSend} top={l.i * 20} />
              ) : null,
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const components: Components = {
  a({ href, children }) {
    const external = typeof href === 'string' && /^https?:/.test(href);
    // Level text may carry a learner-supplied name, so only plain http(s) and in-app hash links are live.
    if (typeof href === 'string' && !external && !href.startsWith('#'))
      return <span>{children}</span>;
    return (
      <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
        {external ? <span className="sr-only"> (opens in a new tab)</span> : null}
      </a>
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className, children }) {
    const text = String(children ?? '');
    const m = /language-([\w-]+)/.exec(className ?? '');
    // react-markdown v10 gives no `inline` flag: a block is a fenced or indented code element with a newline or a language.
    if (m || text.includes('\n')) return <CodeBlock code={text.replace(/\n$/, '')} lang={m?.[1]} />;
    return <InlineCode>{children}</InlineCode>;
  },
  table({ children }) {
    return (
      <div className={styles.tableWrap}>
        <table>{children}</table>
      </div>
    );
  },
};

export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={clsx('md', styles.prose, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {source}
      </ReactMarkdown>
    </div>
  );
}
