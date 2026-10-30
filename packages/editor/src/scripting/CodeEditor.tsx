import { useEffect, useRef } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import {
  ACTIONS,
  ENTITY_METHODS,
  ENTITY_PROPS,
  EVENTS,
  FUNCTIONS,
  READY_TRAITS,
  ROOT_NAMES,
  TRAIT_BY_NAME,
  type Diagnostic,
} from '@ege/runtime';

const theme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--bg)', color: 'var(--text)' },
    '.cm-scroller': { fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', lineHeight: '1.55' },
    '.cm-content': { caretColor: 'var(--accent)' },
    '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--text-dim)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(224,178,58,0.22) !important' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '.cm-tooltip': { backgroundColor: 'var(--panel-header)', border: '1px solid var(--border)', color: 'var(--text)' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text)' },
    '.cm-completionDetail': { color: 'var(--text-dim)', fontStyle: 'normal', marginLeft: '8px' },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
    '.cm-diagnostic-warning': { borderLeftColor: '#e8c467' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(224,178,58,0.18)', outline: 'none' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: '#8fb8e6' },
  { tag: tags.string, color: '#b5cc8a' },
  { tag: [tags.number, tags.bool, tags.null], color: '#e0a86a' },
  { tag: tags.comment, color: '#6b7380', fontStyle: 'italic' },
  { tag: [tags.bracket, tags.punctuation, tags.separator], color: '#9aa2ae' },
  { tag: tags.variableName, color: '#d8dce3' },
]);

function toCm(state: EditorState, d: Diagnostic): CmDiagnostic {
  const line = state.doc.line(Math.min(Math.max(1, d.line), state.doc.lines));
  const from = Math.min(line.from + Math.max(0, d.col - 1), line.to);
  // Underline the word at the reported position (or at least one character).
  const rest = state.doc.sliceString(from, line.to);
  const word = /^("[^"]*"|'[^']*'|[\w$-]+|.)/.exec(rest)?.[0].length ?? 1;
  return { from, to: Math.min(line.to, from + Math.max(1, word)), severity: d.severity, message: d.message };
}

/** Autocomplete driven by the EasyScript spec. */
function complete(propNames: () => string[]) {
  return (ctx: CompletionContext) => {
    const before = ctx.state.doc.sliceString(Math.max(0, ctx.pos - 200), ctx.pos);
    const word = ctx.matchBefore(/[\w$]*/);
    if (!word || (word.from === word.to && !ctx.explicit && !/\.$/.test(before))) return null;

    const member = /\b(self|other|player|input|time|game)\.([\w$]*)$/.exec(before);
    if (member) {
      const root = member[1];
      let options: Completion[];
      if (root === 'self' || root === 'other' || root === 'player') {
        options = [
          ...Object.entries(ENTITY_PROPS).map(([label, info]) => ({ label, type: 'property', info })),
          ...Object.entries(ENTITY_METHODS).map(([label, info]) => ({ label, type: 'method', info, apply: `${label}('')` })),
          ...propNames().map((label) => ({ label, type: 'variable', detail: 'variable' })),
        ];
      } else if (root === 'input') {
        options = ['moveX', 'moveY', 'lookX', 'lookY', 'jump', 'run', 'crouch', 'interact', 'fire', 'aim', 'mouseX', 'mouseY'].map((label) => ({ label, type: 'property' }));
      } else if (root === 'time') {
        options = [
          { label: 'delta', type: 'property', info: 'Seconds since the last frame' },
          { label: 'elapsed', type: 'property', info: 'Seconds since Play started' },
        ];
      } else {
        options = [{ label: 'score', type: 'variable' }, { label: 'checkpoint', type: 'variable' }];
      }
      return { from: ctx.pos - member[2].length, options, validFor: /^[\w$]*$/ };
    }

    const inTraits = /traits\s*:\s*\[[^\]]*$/.test(before);
    if (inTraits) {
      return {
        from: word.from,
        options: READY_TRAITS.map((t) => ({ label: t, type: 'enum', info: TRAIT_BY_NAME.get(t)?.description })),
        validFor: /^[\w-]*$/,
      };
    }

    const inString = (before.match(/"/g)?.length ?? 0) % 2 === 1;
    if (inString) {
      return {
        from: word.from,
        options: [
          ...FUNCTIONS.map((f) => ({ label: f.name, type: 'function', detail: f.signature, info: f.description, apply: `${f.name}(` })),
          ...Object.entries(ROOT_NAMES).map(([label, info]) => ({ label, type: 'keyword', info })),
          ...propNames().map((label) => ({ label, type: 'variable', detail: 'variable' })),
        ],
        validFor: /^[\w$]*$/,
      };
    }

    return {
      from: word.from,
      options: [
        ...ACTIONS.map((a) => ({
          label: a.key,
          type: 'function',
          detail: a.label,
          info: a.description + (a.comingIn ? ` (arrives in ${a.comingIn})` : ''),
          apply: `${a.key}: `,
        })),
        ...EVENTS.map((e) => ({ label: e.key, type: 'class', detail: `event: ${e.label}`, info: e.description, apply: `${e.key}: ` })),
        ...['props', 'traits', 'tags', 'functions', 'on', 'name', 'then', 'else', 'do', 'to', 'value', 'time', 'every', 'after'].map((label) => ({
          label,
          type: 'keyword',
          apply: `${label}: `,
        })),
      ],
      validFor: /^[\w$]*$/,
    };
  };
}

export interface CodeEditorHandle {
  goTo: (line: number, col?: number) => void;
}

/**
 * CodeMirror 6 editor for EasyScript: JSON5 highlighting, live diagnostics (from the engine's
 * own compiler, passed in by the parent) and spec-driven autocomplete.
 */
export function CodeEditor({
  value,
  onChange,
  diagnostics,
  onSave,
  propNames,
  handleRef,
}: {
  value: string;
  onChange: (text: string) => void;
  diagnostics: Diagnostic[];
  onSave?: () => void;
  propNames: () => string[];
  handleRef?: React.MutableRefObject<CodeEditorHandle | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const diagRef = useRef(diagnostics);
  const cb = useRef({ onChange, onSave, propNames });

  useEffect(() => {
    cb.current = { onChange, onSave, propNames };
    diagRef.current = diagnostics;
  });

  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      basicSetup,
      javascript(),
      theme,
      syntaxHighlighting(highlight),
      lintGutter(),
      linter((v) => diagRef.current.map((d) => toCm(v.state, d)), { delay: 250 }),
      autocompletion({ override: [complete(() => cb.current.propNames())], icons: false }),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            cb.current.onSave?.();
            return true;
          },
        },
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) cb.current.onChange(u.state.doc.toString());
      }),
      EditorState.tabSize.of(2),
    ];
    const v = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: host.current });
    view.current = v;
    if (handleRef) {
      handleRef.current = {
        goTo: (line, col = 1) => {
          const l = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
          const pos = Math.min(l.from + col - 1, l.to);
          v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
          v.focus();
        },
      };
    }
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is created once; later value changes are pushed in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (visual builder edits, switching scripts).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="code-editor" />;
}
