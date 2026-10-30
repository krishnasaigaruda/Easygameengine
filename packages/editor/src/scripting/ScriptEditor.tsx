import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTIONS, EVENTS, FUNCTIONS, ScriptSystem } from '@ege/runtime';
import { useScriptEditor, closeScriptEditor } from './scriptEditorState';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import { RuleBuilder } from './RuleBuilder';
import { getAssetText, renameAsset, updateAssetText, useLibrary } from '../assets/library';
import { useEditor } from '../state/editorStore';
import { Icon } from '../ui/Icon';

const SAVE_DELAY_MS = 500;

export function ScriptEditor() {
  const openId = useScriptEditor((s) => s.openId);
  if (!openId) return null;
  return <ScriptEditorDialog key={openId} assetId={openId} />;
}

function ScriptEditorDialog({ assetId }: { assetId: string }) {
  const mode = useScriptEditor((s) => s.mode);
  const asset = useLibrary((s) => s.assets.find((a) => a.id === assetId));
  const playing = useEditor((s) => s.playing);
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const [name, setName] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef('');
  const code = useRef<CodeEditorHandle | null>(null);
  const [showRef, setShowRef] = useState(false);

  useEffect(() => {
    let alive = true;
    void getAssetText(assetId).then((t) => {
      if (!alive) return;
      latest.current = t;
      setText(t);
    });
    return () => {
      alive = false;
    };
  }, [assetId]);

  const compiled = useMemo(() => (text === null ? null : ScriptSystem.check(text, asset?.name ?? 'script')), [text, asset?.name]);

  const flush = async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    await updateAssetText(assetId, latest.current);
    setSaved(true);
  };

  const change = (t: string) => {
    latest.current = t;
    setText(t);
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  };

  // Save pending edits when the dialog closes.
  useEffect(
    () => () => {
      if (timer.current) void updateAssetText(assetId, latest.current);
    },
    [assetId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        closeScriptEditor();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  if (!asset) return null;
  const diagnostics = compiled?.diagnostics ?? [];
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const hasComments = !!text && /\/\/|\/\*/.test(text);

  return (
    <div className="store-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeScriptEditor()}>
      <div className="script-editor" role="dialog" aria-label="Script editor">
        <header className="store-header se-header">
          <Icon name="script" size={16} />
          <input
            className="se-name"
            value={name ?? asset.name}
            onFocus={() => setName(asset.name)}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name !== null) void renameAsset(assetId, name);
              setName(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <div className="se-tabs">
            <button className={mode === 'visual' ? 'active' : ''} onClick={() => useScriptEditor.setState({ mode: 'visual' })}>
              <Icon name="list-checks" size={13} />
              Visual
            </button>
            <button className={mode === 'code' ? 'active' : ''} onClick={() => useScriptEditor.setState({ mode: 'code' })}>
              <Icon name="code" size={13} />
              Code
            </button>
          </div>
          <span className={`se-status ${saved ? 'saved' : ''}`}>
            <Icon name={saved ? 'check' : 'circle-dot'} size={12} />
            {saved ? (playing ? 'Saved · live in game' : 'Saved') : 'Editing…'}
          </span>
          <button className={`small ${showRef ? 'active' : ''}`} onClick={() => setShowRef((v) => !v)}>
            <Icon name="info" size={12} />
            Reference
          </button>
          <button className="icon-btn store-close" onClick={closeScriptEditor} title="Close (Esc)">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="se-body">
          <div className="se-main">
            {text === null ? (
              <p className="empty">Loading…</p>
            ) : mode === 'code' ? (
              <CodeEditor
                value={text}
                onChange={change}
                diagnostics={diagnostics}
                onSave={() => void flush()}
                propNames={() => Object.keys(compiled?.props ?? {})}
                handleRef={code}
              />
            ) : (
              <>
                {hasComments && (
                  <div className="se-notice">
                    <Icon name="info" size={13} />
                    Editing visually rewrites the script's formatting and removes comments.
                  </div>
                )}
                <RuleBuilder source={text} onChange={change} />
              </>
            )}
          </div>

          <aside className="se-side">
            <div className="se-side-title">
              Problems
              <span className={`se-count ${errors ? 'err' : warnings ? 'warn' : 'ok'}`}>
                {errors ? `${errors} error${errors > 1 ? 's' : ''}` : warnings ? `${warnings} warning${warnings > 1 ? 's' : ''}` : 'None'}
              </span>
            </div>
            {diagnostics.length === 0 && <p className="se-ok">No problems found. This script is ready to run.</p>}
            {diagnostics.map((d, i) => (
              <button
                key={i}
                className={`se-problem ${d.severity}`}
                onClick={() => {
                  useScriptEditor.setState({ mode: 'code' });
                  setTimeout(() => code.current?.goTo(d.line, d.col), 30);
                }}
              >
                <Icon name={d.severity === 'error' ? 'x-circle' : 'alert'} size={13} />
                <span>
                  <strong>Line {d.line}</strong> {d.message}
                </span>
              </button>
            ))}

            {showRef && (
              <div className="se-reference">
                <div className="se-side-title">Events</div>
                {EVENTS.filter((e) => !e.aliasOf).map((e) => (
                  <div key={e.key} className="se-ref-item">
                    <code>{e.key}</code>
                    <span>{e.description}</span>
                  </div>
                ))}
                <div className="se-side-title">Actions</div>
                {ACTIONS.map((a) => (
                  <div key={a.key} className="se-ref-item">
                    <code>{a.key}</code>
                    <span>
                      {a.description}
                      {a.comingIn ? ` (arrives in ${a.comingIn})` : ''}
                    </span>
                  </div>
                ))}
                <div className="se-side-title">Functions</div>
                {FUNCTIONS.map((f) => (
                  <div key={f.name} className="se-ref-item">
                    <code>{f.signature}</code>
                    <span>{f.description}</span>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
