// A small Markdown renderer for the repository's own documents (README sections, docs/grading.md).
// It covers what those files use: headings, paragraphs, bullet and numbered lists (nested by indent), pipe
// tables, fenced code, inline code, bold, links and images. It is not a general Markdown engine.
//
// Safety: everything is HTML-escaped. A relative link points at the file on GitHub; the only images that
// are kept are the ones in docs/img/ (the build copies them next to the pages); any other image becomes
// its alt text, so the site can never load a file from another origin.

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const DEFAULTS = { repoUrl: '', imgBase: 'img/', headingShift: 0 };

/** Inline markdown to HTML. */
export function inline(text, opts = {}) {
  const { repoUrl, imgBase } = { ...DEFAULTS, ...opts };
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => {
    const m = /^(?:\.\/)?docs\/img\/([A-Za-z0-9._-]+)$/.exec(src);
    return m ? `<img src="${imgBase}${m[1]}" alt="${alt}" loading="lazy">` : alt;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    let url = href.replace(/&amp;/g, '&');
    if (!/^(https?:|mailto:|#)/.test(url)) url = `${repoUrl}/blob/main/${url.replace(/^\.\//, '')}`;
    return `<a href="${escapeHtml(url)}">${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
}

/** Splits a table row on pipes that are not inside backticks. */
function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  const cells = [];
  let cur = '';
  let inCode = false;
  for (const ch of t) {
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

const isTableSep = (l) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && /-/.test(l);
const listMarker = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function renderList(lines, start, opts) {
  const first = listMarker.exec(lines[start]);
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = listMarker.exec(lines[i]);
    if (!m || m[1].length !== base) break;
    let body = m[3];
    i++;
    let nested = '';
    for (;;) {
      if (i >= lines.length) break;
      const line = lines[i];
      if (line.trim() === '') {
        // a blank line continues the list only if the next non-blank line is an item at this level or deeper
        let j = i;
        while (j < lines.length && lines[j].trim() === '') j++;
        const nm = j < lines.length ? listMarker.exec(lines[j]) : null;
        if (nm && nm[1].length >= base) {
          i = j;
          continue;
        }
        break;
      }
      const lm = listMarker.exec(line);
      if (lm && lm[1].length > base) {
        const r = renderList(lines, i, opts);
        nested += r.html;
        i = r.next;
        continue;
      }
      if (lm && lm[1].length <= base) break;
      if (/^\s+\S/.test(line)) {
        body += ` ${line.trim()}`;
        i++;
        continue;
      }
      break;
    }
    items.push(`<li>${inline(body, opts)}${nested}</li>`);
  }
  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}>${items.join('')}</${tag}>`, next: i };
}

/** Markdown to HTML. `headingShift` moves every heading down that many levels (a page title is already an h1). */
export function renderMarkdown(md, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = /^\s*```/.exec(line);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(6, h[1].length + opts.headingShift);
      out.push(`<h${level}>${inline(h[2], opts)}</h${level}>`);
      i++;
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      out.push(
        `<div class="scroll"><table><thead><tr>${head.map((c) => `<th>${inline(c, opts)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c, opts)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      );
      continue;
    }
    if (listMarker.test(line)) {
      const r = renderList(lines, i, opts);
      out.push(r.html);
      i = r.next;
      continue;
    }
    if (line.startsWith('>')) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith('>'))
        quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote><p>${inline(quote.join(' '), opts)}</p></blockquote>`);
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*```/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !listMarker.test(lines[i]) &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].startsWith('>')
    ) {
      para.push(lines[i++].trim());
    }
    out.push(`<p>${inline(para.join(' '), opts)}</p>`);
  }
  return out.join('\n');
}

/**
 * The part of `md` under the first `## ` heading that contains `titlePart`, up to the next `## ` heading
 * (fences are respected). Returns { title, body } or null.
 */
export function sectionOf(md, titlePart) {
  const lines = md.split('\n');
  let inFence = false;
  let start = -1;
  let title = '';
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    if (/^## /.test(lines[i])) {
      if (start > -1) return { title, body: lines.slice(start + 1, i).join('\n') };
      if (lines[i].includes(titlePart)) {
        start = i;
        title = lines[i].slice(3).trim();
      }
    }
  }
  return start > -1 ? { title, body: lines.slice(start + 1).join('\n') } : null;
}
