// The editor at night. Monaco does not read CSS variables, so every colour is a literal hex copied from
// src/design/tokens.css (the palette of docs/design/EXPERIENCE.md). Plain data: no monaco import, so a test can
// check it against the tokens. MonacoEditor.tsx passes it to `monaco.editor.defineTheme`.

export const NIGHT = {
  n950: '#070A12',
  n900: '#0B1020',
  n800: '#111833',
  n700: '#1A2344',
  n600: '#27325C',
  chalk: '#EEF2FA',
  chalkDim: '#A9B4CC',
  chalkFaint: '#6F7B97',
  flood400: '#FFB347',
  flood500: '#FF9A1F',
  turf: '#2EE281',
  wicket: '#FF5468',
  sky: '#5CC8FF',
  cap: '#B58CFF',
} as const;

export const THEME_NAME = 'quest-night';

const bare = (hex: string) => hex.replace('#', '');

export interface NightThemeData {
  base: 'vs-dark';
  inherit: boolean;
  rules: { token: string; foreground?: string; fontStyle?: string }[];
  colors: Record<string, string>;
}

export const nightTheme: NightThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: bare(NIGHT.chalk) },
    { token: 'comment', foreground: bare(NIGHT.chalkFaint), fontStyle: 'italic' },
    { token: 'keyword', foreground: bare(NIGHT.cap) },
    { token: 'keyword.control', foreground: bare(NIGHT.cap) },
    { token: 'storage', foreground: bare(NIGHT.cap) },
    { token: 'string', foreground: bare(NIGHT.turf) },
    { token: 'string.escape', foreground: bare(NIGHT.flood400) },
    { token: 'number', foreground: bare(NIGHT.flood400) },
    { token: 'regexp', foreground: bare(NIGHT.wicket) },
    { token: 'type', foreground: bare(NIGHT.sky) },
    { token: 'type.identifier', foreground: bare(NIGHT.sky) },
    { token: 'identifier', foreground: bare(NIGHT.chalk) },
    { token: 'delimiter', foreground: bare(NIGHT.chalkDim) },
    { token: 'operator', foreground: bare(NIGHT.chalkDim) },
    { token: 'tag', foreground: bare(NIGHT.sky) },
    { token: 'attribute.name', foreground: bare(NIGHT.flood400) },
    { token: 'attribute.value', foreground: bare(NIGHT.turf) },
    { token: 'metatag', foreground: bare(NIGHT.cap) },
    { token: 'predefined', foreground: bare(NIGHT.sky) },
    // JSON keys, YAML keys, Markdown headings.
    { token: 'string.key.json', foreground: bare(NIGHT.sky) },
    { token: 'string.value.json', foreground: bare(NIGHT.turf) },
    { token: 'keyword.json', foreground: bare(NIGHT.cap) },
    { token: 'strong', foreground: bare(NIGHT.flood400), fontStyle: 'bold' },
    { token: 'emphasis', foreground: bare(NIGHT.chalk), fontStyle: 'italic' },
    { token: 'keyword.md', foreground: bare(NIGHT.flood400) },
    { token: 'string.link.md', foreground: bare(NIGHT.sky) },
    { token: 'variable', foreground: bare(NIGHT.chalk) },
    { token: 'variable.predefined', foreground: bare(NIGHT.sky) },
    { token: 'constant', foreground: bare(NIGHT.flood400) },
  ],
  colors: {
    'editor.background': NIGHT.n900,
    'editor.foreground': NIGHT.chalk,
    'editorCursor.foreground': NIGHT.flood500,
    'editor.selectionBackground': `${NIGHT.flood500}40`,
    'editor.inactiveSelectionBackground': `${NIGHT.flood500}22`,
    'editor.selectionHighlightBackground': `${NIGHT.flood500}22`,
    'editor.wordHighlightBackground': `${NIGHT.sky}24`,
    'editor.wordHighlightStrongBackground': `${NIGHT.sky}34`,
    'editor.findMatchBackground': `${NIGHT.flood500}66`,
    'editor.findMatchHighlightBackground': `${NIGHT.sky}33`,
    'editor.lineHighlightBackground': `${NIGHT.n800}B3`,
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': NIGHT.chalkFaint,
    'editorLineNumber.activeForeground': NIGHT.flood400,
    'editorIndentGuide.background1': `${NIGHT.n600}99`,
    'editorIndentGuide.activeBackground1': NIGHT.chalkFaint,
    'editorBracketMatch.background': `${NIGHT.flood500}2E`,
    'editorBracketMatch.border': `${NIGHT.flood500}99`,
    'editorWhitespace.foreground': `${NIGHT.n600}`,
    'editorRuler.foreground': NIGHT.n700,
    'editorGutter.background': NIGHT.n900,
    'editorOverviewRuler.border': '#00000000',
    'editorError.foreground': NIGHT.wicket,
    'editorWarning.foreground': NIGHT.flood400,
    'editorInfo.foreground': NIGHT.sky,
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': `${NIGHT.n600}99`,
    'scrollbarSlider.hoverBackground': `${NIGHT.chalkFaint}88`,
    'scrollbarSlider.activeBackground': `${NIGHT.chalkFaint}CC`,
    focusBorder: '#00000000',
    'editorWidget.background': NIGHT.n800,
    'editorWidget.border': NIGHT.n600,
    'editorSuggestWidget.background': NIGHT.n800,
    'editorSuggestWidget.border': NIGHT.n600,
    'editorSuggestWidget.selectedBackground': NIGHT.n700,
    'editorSuggestWidget.highlightForeground': NIGHT.flood400,
    'editorHoverWidget.background': NIGHT.n800,
    'editorHoverWidget.border': NIGHT.n600,
    'input.background': NIGHT.n950,
    'input.border': NIGHT.n600,
    'input.foreground': NIGHT.chalk,
    'inputOption.activeBorder': NIGHT.flood500,
    'list.hoverBackground': NIGHT.n700,
    'list.activeSelectionBackground': NIGHT.n700,
    'list.activeSelectionForeground': NIGHT.chalk,
    'widget.shadow': '#00000099',
  },
};

/** What the Monaco `fontFamily` option gets: the self-hosted JetBrains Mono first (next/font's CSS variable). */
export function monoFontStack(cssVar: string): string {
  const own = cssVar.trim();
  const fallback = "'JetBrains Mono Variable', ui-monospace, Menlo, monospace";
  return own ? `${own}, ${fallback}` : fallback;
}
