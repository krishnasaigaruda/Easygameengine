import { useMemo, useState } from 'react';
import { Icon } from '../ui/Icon';
import { docPages, type DocBlock, type DocPage } from './docs';
import { HANDLED, SOFTWARE, SOURCES, type CreditRow } from './credits';

function Block({ b }: { b: DocBlock }) {
  if ('h' in b) return <h3 className="doc-h">{b.h}</h3>;
  if ('p' in b) return <p className="doc-p">{b.p}</p>;
  if ('tip' in b)
    return (
      <p className="doc-tip">
        <Icon name="info" size={14} />
        {b.tip}
      </p>
    );
  if ('code' in b) return <pre className="doc-code">{b.code}</pre>;
  if ('list' in b)
    return (
      <ul className="doc-list">
        {b.list.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    );
  return (
    <table className="doc-table">
      <tbody>
        {b.table.map(([k, v], i) => (
          <tr key={i}>
            <th>{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const textOf = (p: DocPage) =>
  [p.title, ...p.blocks.map((b) => ('h' in b ? b.h : 'p' in b ? b.p : 'tip' in b ? b.tip : 'code' in b ? b.code : 'list' in b ? b.list.join(' ') : b.table.flat().join(' ')))]
    .join(' ')
    .toLowerCase();

/** The documentation: every feature, how to use it, and the full reference. */
export function HubDocs() {
  const pages = useMemo(() => docPages(), []);
  const [open, setOpen] = useState(pages[0].id);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? pages.filter((p) => q.split(/\s+/).every((w) => textOf(p).includes(w))) : pages;
  const page = pages.find((p) => p.id === open) ?? pages[0];
  const groups = [...new Set(shown.map((p) => p.group))];
  return (
    <div className="docs">
      <nav className="docs-nav">
        <input className="hub-search" placeholder="Search the docs…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {groups.map((g) => (
          <div key={g}>
            <div className="docs-group">{g}</div>
            {shown
              .filter((p) => p.group === g)
              .map((p) => (
                <button key={p.id} className={`docs-link ${p.id === page.id ? 'active' : ''}`} onClick={() => setOpen(p.id)}>
                  <Icon name={p.icon} size={14} />
                  {p.title}
                </button>
              ))}
          </div>
        ))}
        {!shown.length && <p className="muted">Nothing found.</p>}
      </nav>
      <article className="docs-page">
        <h2>{page.title}</h2>
        {page.blocks.map((b, i) => (
          <Block key={i} b={b} />
        ))}
      </article>
    </div>
  );
}

function CreditTable({ rows }: { rows: CreditRow[] }) {
  return (
    <table className="doc-table credits-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <th>
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.name}
              </a>
            </th>
            <td>{r.what}</td>
            <td className="credits-license">{r.license}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Who made what this is built with, and how their licences are handled. */
export function HubCredits() {
  return (
    <article className="docs-page credits-page">
      <h2>Credits &amp; licences</h2>
      <p className="doc-p">Easy Game Engine is built on open-source software and free asset libraries. Thank you to everyone who made them.</p>
      <h3 className="doc-h">Software</h3>
      <CreditTable rows={SOFTWARE} />
      <h3 className="doc-h">Asset Store sources</h3>
      <CreditTable rows={SOURCES} />
      <h3 className="doc-h">Licences</h3>
      <ul className="doc-list legal-ok">
        {HANDLED.map((x, i) => (
          <li key={i}>
            <Icon name="check" size={13} />
            {x}
          </li>
        ))}
      </ul>
    </article>
  );
}
