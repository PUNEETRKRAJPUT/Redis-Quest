import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { IconCheck, IconCopy } from './icons';

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

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const h = highlight(code, lang);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span>{h.lang}</span>
        <button type="button" className="icon-btn" onClick={copy} aria-label="Copy code">
          {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre>
        <code className={`hljs language-${h.lang}`} dangerouslySetInnerHTML={{ __html: h.html }} />
      </pre>
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
    return <code className="inline-code">{children}</code>;
  },
  table({ children }) {
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={`md ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {source}
      </ReactMarkdown>
    </div>
  );
}
