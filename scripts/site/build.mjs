#!/usr/bin/env node
// Builds the docs site into site/ from the repository itself. It only reads the repo and writes site/.
//
//   node scripts/site/build.mjs [--out DIR]
//
// Needs `pnpm --filter @quest/shared build` first: the level files are read with the game's own loader
// (packages/shared/dist), so the catalogue can never disagree with what the engine would load.
//
// The site is plain HTML and one stylesheet. It loads nothing from another origin: no fonts, no scripts,
// no analytics, no embeds. Links to GitHub are ordinary links the reader may follow.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { extractCommands } from './commands.mjs';
import { renderMarkdown, inline, escapeHtml as esc, sectionOf } from './markdown.mjs';
import { STYLE } from './style.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_URL = 'https://github.com/PUNEETRKRAJPUT/Redis-Quest';

const outArg = process.argv.indexOf('--out');
const OUT = resolve(ROOT, outArg > -1 ? process.argv[outArg + 1] : 'site');

const read = (rel) => readFile(join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------------------------
// Data: the levels, through the game's own loader

async function loadLevels() {
  const entry = join(ROOT, 'packages/shared/dist/index.js');
  if (!existsSync(entry)) {
    throw new Error(
      'packages/shared/dist is missing: run `pnpm --filter @quest/shared build` first',
    );
  }
  const shared = await import(pathToFileURL(entry).href);
  const result = await shared.loadAllLevels(join(ROOT, 'levels'));
  if (result.errors.length > 0) {
    const first = result.errors
      .slice(0, 5)
      .map((e) => shared.formatLevelError(e, ROOT))
      .join('\n');
    throw new Error(
      `the levels do not validate (${result.errors.length} problems), first:\n${first}`,
    );
  }
  return { shared, chapters: result.chapters };
}

/** "ch1-07-hostel-scoreboard" -> "1.07"; "ch4b-03-..." -> "4b.03"; "finale-02-..." -> "Finale 02". */
function shortId(id) {
  const m = /^(ch(\d+b?)|finale)-(\d\d)-/.exec(id);
  if (!m) return id;
  return m[2] ? `${m[2]}.${m[3]}` : `Finale ${m[3]}`;
}

function chapterLabel(chapter) {
  return chapter.id === 'finale' ? 'Finale' : `Chapter ${chapter.id.slice(2)}`;
}

/**
 * The opening of the level's story, as inline markdown. Many stories open with the chat message that is the
 * incident, written as one backticked line: that line is the opening. Otherwise it is the first sentence, or the
 * first two when the first is very short ("It is 10:32 pm."), shortened to a readable length.
 */
function firstSentence(story) {
  const para = story
    .trim()
    .split(/\n\s*\n/)[0]
    .replace(/\s+/g, ' ')
    .trim();
  const chat = /^`([^`]+)`$/.exec(para);
  let s;
  if (chat) {
    s = chat[1];
  } else {
    const sentences = [];
    for (const part of para.split(/(?<=[.!?])\s+(?=[A-Z"'])/)) {
      // never end a sentence inside an open quotation ("Two workers! Three!")
      const prev = sentences[sentences.length - 1];
      if (prev !== undefined && (prev.match(/"/g) ?? []).length % 2 === 1)
        sentences[sentences.length - 1] = `${prev} ${part}`;
      else sentences.push(part);
    }
    s = sentences[0];
    if (s.length < 40 && sentences.length > 1) s = `${s} ${sentences[1]}`;
  }
  if (s.length > 240) s = `${s.slice(0, 237).replace(/\s+\S*$/, '')}...`;
  return s;
}

async function describeLevels(chapters) {
  const out = [];
  for (const c of chapters) {
    const levels = [];
    for (const loaded of c.levels) {
      const lv = loaded.level;
      const commands = await extractCommands(loaded);
      levels.push({
        id: lv.id,
        short: shortId(lv.id),
        title: lv.title,
        mode: lv.mode,
        xp: lv.reward.xp,
        badge: lv.reward.badge ?? null,
        incident: firstSentence(lv.story),
        interview: lv.interview ? (lv.interview.pool ? 'pool' : 'rebuild') : null,
        commands,
        wrong: lv.solutions ? lv.solutions.wrong.length : 0,
      });
    }
    out.push({
      id: c.chapter.id,
      label: chapterLabel(c.chapter),
      title: c.chapter.title,
      opening: c.chapter.incident[0],
      levels,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Page frame

const NAV = [
  ['index.html', 'Home'],
  ['levels.html', 'Levels'],
  ['commands.html', 'Commands taught'],
  ['grading.html', 'How levels are graded'],
  ['contribute.html', 'Contribute'],
];

function page({ file, title, description, body }) {
  const nav = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${esc(label)}</a>`,
  ).join('\n      ');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <a class="skip" href="#main">Skip to the content</a>
  <header class="top">
    <div class="wrap">
      <a class="brand" href="index.html">Redis Quest</a>
      <nav aria-label="Pages">
      ${nav}
      </nav>
    </div>
  </header>
  <main id="main" class="wrap">
${body}
  </main>
  <footer class="foot">
    <div class="wrap">
      <p>Redis Quest is an independent project, MIT licensed. It is not affiliated with or endorsed by Redis.
      All names, colleges and the league in the story are fictional.</p>
      <p><a href="${REPO_URL}">Source on GitHub</a>. This page is generated from the repository by
      <code>scripts/site/build.mjs</code>; it loads nothing from any other site.</p>
    </div>
  </footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------
// Pages

function homePage(stats, chapters) {
  const modes = Object.entries(stats.modes)
    .map(([m, n]) => `${n} ${m}`)
    .join(', ');
  const shots = [
    [
      'map.jpg',
      'The season map: each chapter a match night with its incident, each level a ball in an over',
    ],
    [
      'mock-interview.jpg',
      'A mock interview: the use case is drawn when you start, the clock runs, the file is blank',
    ],
    [
      'terminal-target.jpg',
      'The terminal with the target switcher: single node, no persistence, replica, Sentinel, cluster',
    ],
    [
      'what-you-built.jpg',
      'What you built: the impact log and every passed level’s panel on your own keys',
    ],
    ['show-me-gallery.jpg', 'The show-me gallery on sample data'],
  ]
    .map(
      ([f, cap]) => `<figure>
      <img src="img/${f}" width="800" height="600" alt="${esc(cap)}" loading="lazy">
      <figcaption>${esc(cap)}</figcaption>
    </figure>`,
    )
    .join('\n    ');
  const rows = chapters
    .map(
      (c) =>
        `<tr><td>${esc(c.id === 'finale' ? 'Finale' : c.id.slice(2))}</td><td><a href="levels.html#chapter-${esc(c.id)}">${esc(c.title)}</a></td><td>${c.levels.length}</td><td>${inline(`“${c.opening.text}”`)}</td></tr>`,
    )
    .join('\n        ');
  return page({
    file: 'index.html',
    title: 'Redis Quest: learn Redis by fixing a cricket app',
    description:
      'A local, story-driven game for backend engineers: real Redis, real Postgres, real traffic, on your own Mac.',
    body: `
    <section class="hero">
      <h1>Redis Quest</h1>
      <p class="lead">A story-driven game that takes a backend engineer with basic JavaScript from &ldquo;never seen
      Redis&rdquo; toward &ldquo;can design, build and operate a Redis system and explain it in an interview&rdquo;.
      You play the backend engineer of a fantasy cricket app that a hostel roommate and you built in a weekend, and
      the app goes wrong, one chapter at a time. Everything runs on your own Mac.</p>
      <p class="notice"><strong>Status:</strong> a release candidate. The game is built and every level is
      machine-graded, but nobody except its author has played it yet. A first playtest is the next step, so expect
      rough edges, and tell us about them. Redis Quest is independent: it is not affiliated with or endorsed by Redis.</p>
      <p><a class="button" href="${REPO_URL}">Get it on GitHub</a>
      <a class="button ghost" href="#start">How to start</a></p>
    </section>

    <section>
      <h2>What is in it</h2>
      <ul class="facts">
        <li><strong>${stats.chapters} chapters, ${stats.levels} levels.</strong> Counted from the level files in this
        build: ${esc(modes)}. See the <a href="levels.html">level catalogue</a>.</li>
        <li><strong>A real backend to break and fix.</strong> A Fastify app over a seeded Postgres, a load generator,
        and your code loaded into named slots of that app while it serves.</li>
        <li><strong>Graded against a real Redis.</strong> Each level declares checks (behaviour, traffic, Redis state,
        antipatterns, events, quizzes). &ldquo;Works, but wrong&rdquo; is a verdict of its own. See
        <a href="grading.html">how levels are graded</a>.</li>
        <li><strong>${stats.commands} distinct Redis commands</strong> appear in the reference solutions, indexed
        on the <a href="commands.html">commands taught</a> page (read from the files by pattern; see the note there).</li>
        <li><strong>Scale and failure on a laptop</strong> in Chapter 5: a replica, three Sentinels and a six-node
        cluster, started by you with the commands the levels give.</li>
      </ul>
    </section>

    <section>
      <h2>The story</h2>
      <p>You and Sai Teja (&ldquo;Teja&rdquo;), your roommate who does the frontend and screenshots every error before
      reading it, built a fantasy cricket app for the Nukkad Cricket League, a fictional eight-franchise league.
      Harry Bhaiya, the final-year senior who runs the college fest, announced it in every mess hall, so it has
      users before it has a cache. Every chapter opens with the chat thread as it arrived, and every level is one
      thing that went wrong that night. All names, colleges and the league are fictional.</p>
    </section>

    <section>
      <h2>The eight chapters</h2>
      <div class="scroll">
      <table>
        <thead><tr><th>Chapter</th><th>Title</th><th>Levels</th><th>It opens with</th></tr></thead>
        <tbody>
        ${rows}
        </tbody>
      </table>
      </div>
    </section>

    <section>
      <h2>Screenshots</h2>
      <div class="shots">
    ${shots}
      </div>
    </section>

    <section id="start">
      <h2>How to start</h2>
      <p>You need a Mac with Apple Silicon (M1 or newer) and at least 16 GB of RAM, Docker Desktop for Mac (the Apple
      Silicon build) with 8 GB of memory assigned to it, and Git. Windows, Intel Macs and Linux are not supported in
      this version. No Node, no Homebrew, no Redis install.</p>
      <pre><code>git clone ${REPO_URL}.git
cd Redis-Quest
./scripts/start</code></pre>
      <p>Then open <code>http://localhost:3000</code>. The first start downloads images and builds the game, so give it
      a few minutes. <code>scripts/start</code> runs <code>scripts/preflight.sh</code> first and says in plain words
      what is missing. Every port is bound to 127.0.0.1; nothing is reachable from your network and nothing is hosted.</p>
    </section>
`,
  });
}

function levelsPage(chapters, stats) {
  const toc = chapters
    .map(
      (c) =>
        `<li><a href="#chapter-${esc(c.id)}">${esc(c.label)}: ${esc(c.title)}</a> <span class="dim">(${c.levels.length})</span></li>`,
    )
    .join('\n        ');
  const sections = chapters
    .map((c) => {
      const rows = c.levels
        .map((l) => {
          const cmds =
            l.commands.kind === 'commands'
              ? l.commands.names
                  .map((n) => `<a class="chip" href="commands.html#${anchorFor(n)}">${esc(n)}</a>`)
                  .join(' ')
              : `<span class="dim">${esc(l.commands.note)}</span>`;
          const tag = l.interview
            ? ` <span class="tag">${l.interview === 'pool' ? 'drawn mock interview' : 'timed rebuild'}</span>`
            : '';
          return `<tr id="${esc(l.id)}">
          <td class="nowrap"><a href="#${esc(l.id)}">${esc(l.short)}</a></td>
          <td>${esc(l.title)}${tag}</td>
          <td>${esc(l.mode)}</td>
          <td class="num">${l.xp}</td>
          <td>${inline(l.incident)}</td>
          <td>${cmds}</td>
        </tr>`;
        })
        .join('\n        ');
      return `
    <section id="chapter-${esc(c.id)}">
      <h2>${esc(c.label)}: ${esc(c.title)}</h2>
      <p class="opening">Opens with: ${inline(`“${c.opening.text}”`)}</p>
      <div class="scroll">
      <table class="catalogue">
        <thead><tr><th>Level</th><th>Title</th><th>Mode</th><th>XP</th><th>The incident</th><th>Commands in the reference solution</th></tr></thead>
        <tbody>
        ${rows}
        </tbody>
      </table>
      </div>
    </section>`;
    })
    .join('\n');
  return page({
    file: 'levels.html',
    title: `Level catalogue: all ${stats.levels} levels`,
    description: `Every level of Redis Quest by chapter: title, mode, XP, the incident and the Redis commands its reference solution uses.`,
    body: `
    <h1>Level catalogue</h1>
    <p>All ${stats.levels} levels in ${stats.chapters} chapters, read from the level files by the game&rsquo;s own loader when
    this page was built. The incident is the first sentence of the level&rsquo;s story. The commands are read from the
    level&rsquo;s reference solution file by pattern (see the note on the <a href="commands.html">commands page</a>);
    decision levels and the drawn mock interviews have no solution file of their own, and say so.</p>
    <nav class="toc" aria-label="Chapters"><ul>
        ${toc}
    </ul></nav>
${sections}
`,
  });
}

/** An id-safe anchor for a command name ("CONFIG GET" -> "config-get", "JSON.SET" -> "json.set"). */
function anchorFor(name) {
  return `cmd-${name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}`;
}

function commandsPage(chapters, stats) {
  const index = new Map();
  for (const c of chapters) {
    for (const l of c.levels) {
      if (l.commands.kind !== 'commands') continue;
      for (const name of l.commands.names) {
        if (!index.has(name)) index.set(name, []);
        index.get(name).push(l);
      }
    }
  }
  const names = [...index.keys()].sort((a, b) => a.localeCompare(b));
  const letters = [...new Set(names.map((n) => n[0]))];
  const jump = letters.map((ch) => `<a href="#letter-${ch}">${ch}</a>`).join(' ');
  let currentLetter = '';
  const rows = names
    .map((name) => {
      const levels = index.get(name);
      const anchor = currentLetter !== name[0] ? ` id="letter-${(currentLetter = name[0])}"` : '';
      const links = levels
        .map(
          (l) => `<a href="levels.html#${esc(l.id)}" title="${esc(l.title)}">${esc(l.short)}</a>`,
        )
        .join(', ');
      return `<tr${anchor}><td id="${anchorFor(name)}"><code>${esc(name)}</code></td><td class="num">${levels.length}</td><td>${links}</td></tr>`;
    })
    .join('\n        ');
  return page({
    file: 'commands.html',
    title: 'Commands taught: Redis command to levels',
    description: 'Which Redis Quest levels use each Redis command in their reference solution.',
    body: `
    <h1>Commands taught</h1>
    <p>${stats.commands} distinct commands, each linked to the levels whose reference solution uses it. Where a command
    has subcommands (<code>CONFIG GET</code>, <code>XINFO STREAM</code>) the subcommand is part of the name.</p>
    <p class="notice"><strong>How this index is made.</strong> A script reads each reference solution file and pulls out
    command names: the first word of every line of a <code>.redis</code> file, the client calls in a <code>.js</code> file
    (<code>redis.hSet</code> is <code>HSET</code>), the commands named in <code>sendCommand</code> and in the Lua
    <code>redis.call</code> of its scripts, and the <code>redis-cli</code> lines of a <code>.sh</code> file. It reads
    patterns, not meaning, so a level can teach a command that its reference solution does not use (a quiz, an
    explanation) and a command can be listed that the solution only runs once as a check. Treat it as an index, not a syllabus.</p>
    <p class="jump" aria-label="Jump to a letter">${jump}</p>
    <div class="scroll">
    <table>
      <thead><tr><th>Command</th><th>Levels</th><th>Which</th></tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    </div>
`,
  });
}

async function gradingPage() {
  const readme = await read('README.md');
  const learner = sectionOf(readme, 'How your work is graded');
  const authors = await read('docs/grading.md');
  return page({
    file: 'grading.html',
    title: 'How levels are graded',
    description:
      'Nothing in Redis Quest is graded by reading your code: each level declares checks that run against the real stack.',
    body: `
    <h1>How levels are graded</h1>
    <p>First, what a player sees. Then, for people who write levels, how the grading harness proves that every level
    gives the verdict it declares. Both parts are copied from the repository&rsquo;s own documents when the site is built.</p>
    <section>
      <h2>For players</h2>
      ${learner ? renderMarkdown(learner.body, { repoUrl: REPO_URL, imgBase: 'img/' }) : '<p>Not found in the README.</p>'}
    </section>
    <section>
      <h2>For level authors: the grading harness</h2>
      <p class="dim">From <a href="${REPO_URL}/blob/main/docs/grading.md"><code>docs/grading.md</code></a>.</p>
      ${renderMarkdown(publicGrading(authors), { repoUrl: REPO_URL, imgBase: 'img/', headingShift: 1 })}
    </section>
`,
  });
}

// docs/grading.md names the build tasks that added each rule (E-04, A-02 ...). They mean nothing to a reader of
// the site, so they are left out of the public copy; the document itself is unchanged.
const TASK_ID = String.raw`(?:[EACFG]-\d\d|C4)`;
function publicGrading(md) {
  return md
    .replace(/^# .*\n/, '')
    .replace(new RegExp(` \\(${TASK_ID}(?:, ${TASK_ID})*\\)`, 'g'), '')
    .replace(new RegExp(`\\(${TASK_ID}[,;] `, 'g'), '(')
    .replace(new RegExp(`, ${TASK_ID}\\)`, 'g'), ')')
    .replace(/ \(A-0\d not merged\)/g, '')
    .replace(/A-04's/g, "the app's");
}

async function contributePage(stats) {
  const readme = await read('README.md');
  const contributing = sectionOf(readme, 'Contributing');
  return page({
    file: 'contribute.html',
    title: 'Contribute to Redis Quest',
    description: 'How the game was built, how to add or fix a level, and where to start.',
    body: `
    <h1>Contribute</h1>
    <p>Redis Quest is MIT licensed and the repository is public. The most useful things right now are playtest findings
    and small fixes to levels and docs.</p>

    <section>
      <h2>Where to start</h2>
      <ul>
        <li><strong>Play it and tell us where you got stuck.</strong> Open an issue with the
        <a href="${REPO_URL}/blob/main/.github/ISSUE_TEMPLATE/playtest-finding.md">playtest finding template</a>. How long you
        were stuck, even 30 seconds, is the useful number. The
        <a href="${REPO_URL}/blob/main/docs/TESTING.md">tester guide</a> says what to look for.</li>
        <li><strong>Pick a small issue.</strong> Starter issues are labelled
        <a href="${REPO_URL}/labels/good%20first%20issue"><code>good first issue</code></a> on GitHub, each naming the file to
        look at.</li>
        <li><strong>Write or change a level.</strong> A level is one YAML file plus a reference solution and at least one
        known-wrong solution. Read <a href="${REPO_URL}/blob/main/levels/README.md"><code>levels/README.md</code></a>, copy an
        example from <code>levels/_examples/</code> and keep the validator clean.</li>
      </ul>
    </section>

    <section>
      <h2>Checks you can run</h2>
      <p>The level validator does not need Docker:</p>
      <pre><code>pnpm install --frozen-lockfile
pnpm --filter @quest/shared build
pnpm --filter @quest/shared levels:validate levels</code></pre>
      <p>Today it prints <code>OK (${stats.chapters} chapter(s), ${stats.levels} level(s))</code> on a clean tree. The
      continuous integration on every pull request builds the workspace, lints, checks formatting, runs the unit tests and
      validates the levels. Proving a level&rsquo;s solutions against a real stack uses the grading harness (see
      <a href="grading.html">how levels are graded</a>) and needs the game running on an Apple Silicon Mac.</p>
    </section>

    <section>
      <h2>How it was built</h2>
      ${contributing ? renderMarkdown(contributing.body, { repoUrl: REPO_URL, imgBase: 'img/' }) : '<p>Not found in the README.</p>'}
    </section>
`,
  });
}

// ---------------------------------------------------------------------------------------------
// Main

async function main() {
  const { chapters: loaded } = await loadLevels();
  const chapters = await describeLevels(loaded);

  const modes = {};
  const commandSet = new Set();
  let levels = 0;
  for (const c of chapters) {
    for (const l of c.levels) {
      levels++;
      modes[l.mode] = (modes[l.mode] ?? 0) + 1;
      if (l.commands.kind === 'commands') l.commands.names.forEach((n) => commandSet.add(n));
    }
  }
  const stats = { chapters: chapters.length, levels, modes, commands: commandSet.size };

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'img'), { recursive: true });
  const files = {
    'index.html': homePage(stats, chapters),
    'levels.html': levelsPage(chapters, stats),
    'commands.html': commandsPage(chapters, stats),
    'grading.html': await gradingPage(),
    'contribute.html': await contributePage(stats),
    'style.css': STYLE,
    '.nojekyll': '',
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(OUT, name), content);
  await cp(join(ROOT, 'docs/img'), join(OUT, 'img'), { recursive: true });

  console.log(
    `site: ${Object.keys(files).filter((f) => f.endsWith('.html')).length} pages, ${stats.chapters} chapters, ${stats.levels} levels, ${stats.commands} commands -> ${OUT}`,
  );
}

main().catch((e) => {
  console.error(`site build failed: ${e.message}`);
  process.exit(1);
});
