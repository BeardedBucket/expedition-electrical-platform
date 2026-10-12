import { useEffect, useRef, useState } from 'react';
import type { HumanEvidencePage, OperatorApi } from './api.js';
import { OperatorApiError } from './api.js';
import { ReviewHelp } from './ReviewHelp.js';
import { ReviewValue } from './ReviewValue.js';
export type EvidenceRole = 'statement' | 'condition' | 'model';
export type SourceEntry = HumanEvidencePage['entries'][number];
export const sourceEntryKey = (entry: SourceEntry) =>
  `${entry.document_id}:${entry.block_id}:${'cell_id' in entry ? entry.cell_id : ''}`;
export function SourceEvidenceNavigator({
  jobId,
  snapshot,
  client,
  documents,
  initialDocumentId,
  disabled,
  onUse,
  onStale,
}: {
  jobId: string;
  snapshot: string;
  client: OperatorApi;
  documents: { id: string; title: string }[];
  initialDocumentId?: string;
  disabled: boolean;
  onUse: (entry: SourceEntry, roles: EvidenceRole[]) => void;
  onStale: () => void;
}) {
  const [documentId, setDocumentId] = useState(
    () =>
      documents.find((document) => document.id === initialDocumentId)?.id ?? documents[0]?.id ?? '',
  );
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<HumanEvidencePage>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<SourceEntry>();
  const [roles, setRoles] = useState<EvidenceRole[]>([]);
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const detail = useRef<HTMLElement>(null);
  const [selectionRevision, setSelectionRevision] = useState(0);
  useEffect(() => {
    if (selectionRevision) {
      detail.current?.focus();
      detail.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [selectionRevision]);
  useEffect(() => {
    let active = true;
    setPage(undefined);
    setError('');
    if (!documentId) {
      setError('No retained document is available. Retain an unresolved draft.');
      return;
    }
    void client
      .humanEvidence(jobId, {
        expected_review_snapshot: snapshot,
        document_id: documentId,
        offset,
        query,
      })
      .then((next) => {
        if (active) setPage(next);
      })
      .catch((e) => {
        if (active) {
          setError(e instanceof Error ? e.message : 'Source search failed.');
          if (e instanceof OperatorApiError && e.status === 409) onStale();
        }
      });
    return () => {
      active = false;
    };
  }, [client, jobId, snapshot, documentId, query, offset, revision, onStale]);
  useEffect(() => {
    if (!expanded) return;
    const element = dialog.current;
    // This overlay owns its own focus/scroll lifetime. Closing does not remount
    // the navigator or editor, so source selection, queries and drafts survive.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    try {
      if (element?.showModal) element.showModal();
      else element?.setAttribute('open', '');
    } catch {
      element?.setAttribute('open', '');
    }
    search.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [expanded]);
  const close = () => {
    try {
      dialog.current?.close?.();
    } catch {
      dialog.current?.removeAttribute('open');
    }
    setExpanded(false);
    trigger.current?.focus();
  };
  const location = (entry: SourceEntry) =>
    [
      entry.locator.kind,
      entry.locator.page ? `Page ${entry.locator.page}` : '',
      entry.locator.section ?? '',
      'cell_id' in entry ? `Cell ${entry.cell_id}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  const contents = (full: boolean) => (
    <>
      <label>
        Retained document
        <select
          value={documentId}
          disabled={disabled}
          onChange={(e) => {
            setDocumentId(e.target.value);
            setOffset(0);
            setSelected(undefined);
            setRoles([]);
          }}
        >
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        {full ? 'Search all source evidence' : 'Search source evidence'}
        <input
          ref={full ? search : undefined}
          type="search"
          value={query}
          disabled={disabled}
          placeholder="Manufacturer wording, headings, page or section…"
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      {error ? (
        <div role="alert">
          {error}
          <button type="button" onClick={() => setRevision((n) => n + 1)}>
            Retry source search
          </button>
        </div>
      ) : !page ? (
        <p role="status">Searching retained source…</p>
      ) : (
        <>
          <p className="muted" role="status">
            {page.total} source {page.total === 1 ? 'match' : 'matches'} ·{' '}
            {page.document_total ?? page.total} available entries in this document
          </p>
          {!page.total && (
            <p>
              No retained passages match. Try different source wording or clear the source search.
            </p>
          )}
          {query && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setQuery('');
                setOffset(0);
              }}
            >
              Clear source search
            </button>
          )}
          <div className={full ? 'source-browser-layout' : ''}>
            <div>
              <ul className="source-search-results" aria-label="Source evidence results">
                {/* Six inline cards keep the editor compact; the browser exposes the
                    full fifty-entry page. These bounds never truncate cited text. */}
                {page.entries.slice(0, full ? page.entries.length : 6).map((entry) => (
                  <li key={sourceEntryKey(entry)}>
                    <button
                      type="button"
                      className="source-result"
                      aria-pressed={selected && sourceEntryKey(selected) === sourceEntryKey(entry)}
                      onClick={() => {
                        setSelected(entry);
                        setRoles([]);
                        setSelectionRevision((n) => n + 1);
                      }}
                      disabled={disabled}
                    >
                      {/* This is a card synopsis only. Selection/citation always uses the complete retained text. */}
                      <span>
                        {entry.text.length > 180 ? entry.text.slice(0, 180) + '…' : entry.text}
                      </span>
                      <small>Original retained source · {location(entry)}</small>
                    </button>
                  </li>
                ))}
              </ul>
              {!full && page.entries.length > 6 && (
                <p className="muted">
                  Showing six matching passages here. Browse source evidence for the complete page.
                </p>
              )}
              <div className="source-pagination">
                <button
                  type="button"
                  disabled={!offset || disabled}
                  onClick={() => setOffset(Math.max(0, offset - 50))}
                >
                  Previous source results
                </button>
                <span>
                  {page.total
                    ? `${offset + 1}–${offset + page.entries.length} of ${page.total}`
                    : '0 results'}
                </span>
                <button
                  type="button"
                  disabled={page.next_offset === undefined || disabled}
                  onClick={() => setOffset(page.next_offset!)}
                >
                  Next source results
                </button>
              </div>
            </div>
            {selected && (
              <article
                className="selected-source-passage"
                ref={detail}
                tabIndex={-1}
                aria-label="Selected manufacturer passage"
              >
                <h5>Original manufacturer passage</h5>
                <pre>{selected.text}</pre>
                <p className="muted">
                  {location(selected)} ·{' '}
                  {selected.locator.kind === 'pdf' && !('cell_id' in selected)
                    ? 'Retained PDF text; table ownership is not established by selecting it.'
                    : 'Selecting text does not establish model applicability.'}
                </p>
                <fieldset disabled={disabled}>
                  <legend>
                    What does this passage support?{' '}
                    <ReviewHelp topic="Evidence roles">
                      A statement citation records source text. A condition keeps qualifying
                      context. Model evidence still needs an explicit source relationship and server
                      validation.
                    </ReviewHelp>
                  </legend>
                  {(['statement', 'condition', 'model'] as const).map((role) => (
                    <label key={role} className="evidence-role">
                      <input
                        type="checkbox"
                        checked={roles.includes(role)}
                        onChange={(e) =>
                          setRoles((previous) =>
                            e.target.checked
                              ? [...previous, role]
                              : previous.filter((r) => r !== role),
                          )
                        }
                      />
                      {
                        {
                          statement: 'Value or original statement',
                          condition: 'Applicable condition',
                          model: 'Model or part-number relationship',
                        }[role]
                      }
                    </label>
                  ))}
                  <button
                    type="button"
                    disabled={!roles.length}
                    onClick={() => {
                      onUse(selected, roles);
                      if (expanded) close();
                    }}
                  >
                    Use selected evidence
                  </button>
                </fieldset>
                <details>
                  <summary>Exact retained locator</summary>
                  <ReviewValue value={selected.locator} />
                </details>
              </article>
            )}
          </div>
        </>
      )}
    </>
  );
  return (
    <section
      id="human-source-evidence"
      tabIndex={-1}
      className="manufacturer-evidence evidence-navigator"
      aria-label="Manufacturer evidence navigator"
    >
      <div className="correction-section-heading">
        <h4>2 · Original manufacturer evidence</h4>
        <button
          ref={trigger}
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={() => setExpanded(true)}
        >
          Browse source evidence
        </button>
      </div>
      <p className="muted">
        Search retained manufacturer text. This search does not search engineering properties.
      </p>
      {!expanded && contents(false)}
      {expanded && (
        <dialog
          ref={dialog}
          className="property-explorer source-browser"
          aria-modal="true"
          aria-label="Source evidence browser"
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
            if (e.key === 'Tab') {
              const nodes = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled),input,select,summary,[tabindex="0"]',
                ),
              );
              if (e.shiftKey && document.activeElement === nodes[0]) {
                e.preventDefault();
                nodes.at(-1)?.focus();
              } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
                e.preventDefault();
                nodes[0]?.focus();
              }
            }
          }}
        >
          <div className="explorer-header">
            <h2>Browse retained source evidence</h2>
            <button type="button" onClick={close}>
              Close source browser
            </button>
          </div>
          {contents(true)}
        </dialog>
      )}
    </section>
  );
}
