import { create } from 'zustand';
import { useEffect } from 'react';
import { IS_MAC, SHORTCUTS, formatKeys, type Shortcut } from '../editor/keymap';
import { Icon } from '../ui/Icon';

export const useShortcutsDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openShortcuts = () => useShortcutsDialog.setState({ open: true });
const close = () => useShortcutsDialog.setState({ open: false });

const GROUPS: Shortcut['group'][] = ['General', 'Edit', 'Selection', 'Tools', 'View', 'Play'];

function Keys({ keys }: { keys: string }) {
  return (
    <span className="keys">
      {formatKeys(keys)
        .split(IS_MAC ? ' + ' : '+')
        .map((k, i) => (
          <kbd key={i}>{k}</kbd>
        ))}
    </span>
  );
}

/** The list of every keyboard shortcut (Help, or press ?). */
export function ShortcutsDialog() {
  const open = useShortcutsDialog((s) => s.open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  if (!open) return null;
  return (
    <div className="store-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="shortcuts-dialog" role="dialog" aria-label="Keyboard shortcuts">
        <header className="store-header">
          <h2>
            <Icon name="keyboard" size={18} />
            Keyboard Shortcuts
          </h2>
          <span className="muted">{IS_MAC ? 'Cmd and Ctrl both work.' : 'On a Mac, use Cmd instead of Ctrl.'}</span>
          <button className="icon-only store-close" onClick={close} title="Close (Esc)">
            <Icon name="x" />
          </button>
        </header>
        <div className="shortcuts-grid">
          {GROUPS.map((g) => (
            <section key={g}>
              <h3>{g}</h3>
              <table>
                <tbody>
                  {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                    <tr key={s.id}>
                      <td>{s.label}</td>
                      <td>
                        <Keys keys={s.keys} />
                        {s.alt && formatKeys(s.alt) !== formatKeys(s.keys) && (
                          <>
                            <span className="muted"> or </span>
                            <Keys keys={s.alt} />
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
