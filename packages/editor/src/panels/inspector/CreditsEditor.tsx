import { useEffect, useState } from 'react';
import { useLibrary, readProjectCredits, setAssetCredit, writeProjectCredits, type ProjectCredit } from '../../assets/library';
import { Icon } from '../../ui/Icon';

/** Suggestions for the licence box (anything can be typed). */
const LICENSES = ['My own work', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'CC-BY-SA-4.0', 'MIT', 'Public Domain', 'Used with permission'];

function LicenseInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <input list="ege-licenses" value={value} placeholder="e.g. CC-BY-4.0" onChange={(e) => onChange(e.target.value)} />
      <datalist id="ege-licenses">
        {LICENSES.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
    </>
  );
}

const blank = (): ProjectCredit => ({ name: '', author: '', license: '', url: '' });

/**
 * credits.json as a form: one row per credit. Saved as plain JSON in the project, so it can also
 * be edited by hand (in a project folder, or after exporting the project file).
 */
export function CreditsEditor() {
  const version = useLibrary((s) => s.assets.length);
  const [list, setList] = useState<ProjectCredit[] | null>(null);
  useEffect(() => {
    void readProjectCredits().then(setList);
  }, [version]);
  if (!list) return null;

  const save = (next: ProjectCredit[]) => {
    setList(next);
    void writeProjectCredits(next);
  };
  const change = (i: number, patch: Partial<ProjectCredit>) => save(list.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <section className="component-card">
      <header className="component-header">
        <Icon name="heart" className="component-icon" />
        <span className="component-title">Credits ({list.length})</span>
      </header>
      <div className="component-body credits-editor">
        <p className="component-desc">
          Everyone to thank that the Asset Store doesn't credit already: your own imported models, music by a friend, a font… They appear in the game's Credits screen.
        </p>
        {list.map((c, i) => (
          <div key={i} className="credit-row">
            <div className="credit-row-head">
              <input className="credit-name" value={c.name} placeholder="What it is (e.g. Castle model)" onChange={(e) => change(i, { name: e.target.value })} />
              <button className="icon-btn" title="Remove" onClick={() => save(list.filter((_, j) => j !== i))}>
                <Icon name="trash" size={13} />
              </button>
            </div>
            <div className="field">
              <label className="field-label">Made by</label>
              <div className="field-control">
                <input value={c.author} placeholder="Name" onChange={(e) => change(i, { author: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label className="field-label">Licence</label>
              <div className="field-control">
                <LicenseInput value={c.license} onChange={(license) => change(i, { license })} />
              </div>
            </div>
            <div className="field">
              <label className="field-label">Link</label>
              <div className="field-control">
                <input value={c.url} placeholder="https://… (optional)" onChange={(e) => change(i, { url: e.target.value })} />
              </div>
            </div>
          </div>
        ))}
        <button className="small" onClick={() => save([...list, blank()])}>
          <Icon name="plus" size={12} />
          Add credit
        </button>
      </div>
    </section>
  );
}

/** Who made one of your own imports: filled in, it goes into the game's Credits. */
export function OwnAssetCredit({ assetId, credit }: { assetId: string; credit?: { author?: string; license?: string; url?: string } }) {
  const [c, setC] = useState({ author: credit?.author ?? '', license: credit?.license ?? '', url: credit?.url ?? '' });
  const set = (patch: Partial<typeof c>) => {
    const next = { ...c, ...patch };
    setC(next);
    void setAssetCredit(assetId, next);
  };
  return (
    <section className="component-card">
      <header className="component-header">
        <Icon name="heart" className="component-icon" />
        <span className="component-title">Credit</span>
      </header>
      <div className="component-body">
        <p className="component-desc">Made by someone? Say who, and the game's Credits list it.</p>
        <div className="field">
          <label className="field-label">Made by</label>
          <div className="field-control">
            <input value={c.author} placeholder="Name (empty = not credited)" onChange={(e) => set({ author: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label className="field-label">Licence</label>
          <div className="field-control">
            <LicenseInput value={c.license} onChange={(license) => set({ license })} />
          </div>
        </div>
        <div className="field">
          <label className="field-label">Link</label>
          <div className="field-control">
            <input value={c.url} placeholder="https://… (optional)" onChange={(e) => set({ url: e.target.value })} />
          </div>
        </div>
      </div>
    </section>
  );
}
