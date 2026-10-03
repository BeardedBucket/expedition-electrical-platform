import { Fragment, useEffect, useState, type FormEvent } from 'react';
import {
  MAX_BATCH_SIZE,
  type IngestionBatchDetail,
  type IngestionBatchSummary,
  type IntakeInput,
  type OperatorApi,
} from './api.js';

const emptyIntake = (): IntakeInput => ({
  manufacturer: '',
  product_model: '',
  manufacturer_part_number: '',
  official_product_uri: '',
});
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'An unexpected request error occurred.';

export function BatchCreate({ client }: { client: OperatorApi }) {
  const [products, setProducts] = useState<IntakeInput[]>([emptyIntake()]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  function update(index: number, field: keyof IntakeInput, value: string) {
    setProducts((current) =>
      current.map((product, productIndex) =>
        productIndex === index ? { ...product, [field]: value } : product,
      ),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (products.length < 1 || products.length > MAX_BATCH_SIZE) {
      setError(`A batch must contain between 1 and ${MAX_BATCH_SIZE} products.`);
      return;
    }
    const missingIdentity = products.findIndex(
      (product) =>
        !product.manufacturer.trim() ||
        !product.product_model.trim() ||
        (!product.manufacturer_part_number.trim() && !product.official_product_uri.trim()),
    );
    if (missingIdentity >= 0) {
      setError(
        `Product ${missingIdentity + 1} needs a manufacturer, product model, and at least a part number or official product URL.`,
      );
      return;
    }
    setPending(true);
    try {
      const result = await client.createBatch(products);
      window.location.hash = `/batches/${result.summary.id}`;
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="intake">
      <div className="eyebrow">Batch intake · 1–{MAX_BATCH_SIZE} products</div>
      <h1>Create batch</h1>
      <p>
        Add ordinary product intakes. Each child remains an individual job with its own preparation
        and human review.
      </p>
      <p className="muted">
        Creating a batch only groups jobs; it does not approve, finalize, or write product data.
      </p>
      {error && <p role="alert">{error}</p>}
      <form autoComplete="off" onSubmit={(event) => void submit(event)}>
        <p className="muted" role="status">
          {products.length} of {MAX_BATCH_SIZE} products
        </p>
        {products.map((product, index) => (
          <fieldset className="batch-product" key={index}>
            <legend>Product {index + 1}</legend>
            <label>
              Manufacturer *
              <input
                aria-label={`Product ${index + 1} Manufacturer`}
                required
                autoComplete="off"
                value={product.manufacturer}
                onChange={(event) => update(index, 'manufacturer', event.target.value)}
              />
            </label>
            <label>
              Product model *
              <input
                aria-label={`Product ${index + 1} Product model`}
                required
                autoComplete="off"
                value={product.product_model}
                onChange={(event) => update(index, 'product_model', event.target.value)}
              />
            </label>
            <label>
              Manufacturer part number
              <input
                aria-label={`Product ${index + 1} Manufacturer part number`}
                autoComplete="off"
                value={product.manufacturer_part_number}
                onChange={(event) => update(index, 'manufacturer_part_number', event.target.value)}
              />
            </label>
            <label>
              Official product URL
              <input
                aria-label={`Product ${index + 1} Official product URL`}
                autoComplete="off"
                type="url"
                value={product.official_product_uri}
                onChange={(event) => update(index, 'official_product_uri', event.target.value)}
              />
            </label>
            <p className="muted">
              Provide at least a manufacturer part number or an official product URL.
            </p>
            <button
              className="secondary"
              type="button"
              disabled={products.length === 1 || pending}
              onClick={() => setProducts((current) => current.filter((_, i) => i !== index))}
            >
              Remove product {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          className="secondary"
          type="button"
          disabled={products.length >= MAX_BATCH_SIZE || pending}
          onClick={() => setProducts((current) => [...current, emptyIntake()])}
        >
          {products.length >= MAX_BATCH_SIZE ? 'Maximum batch size reached' : 'Add product'}
        </button>
        <button disabled={pending}>{pending ? 'Creating batch…' : 'Create batch'}</button>
      </form>
    </section>
  );
}

export function BatchList({ client }: { client: OperatorApi }) {
  const [batches, setBatches] = useState<IngestionBatchSummary[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    void client
      .listBatches()
      .then((response) => {
        if (active) setBatches(response.batches);
      })
      .catch((requestError: unknown) => {
        if (active) setError(errorMessage(requestError));
      });
    return () => {
      active = false;
    };
  }, [client]);

  return (
    <section>
      <div className="batch-heading">
        <div>
          <h1>Ingestion batches</h1>
          <p>Durable groups of ordinary ingestion jobs.</p>
        </div>
        <a className="button-link" href="#/batches/new">
          Create batch
        </a>
      </div>
      {error && <p role="alert">{error}</p>}
      {!batches ? (
        !error && <p role="status">Loading batches…</p>
      ) : !batches.length ? (
        <p className="empty">No batches yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Batch ID</th>
                <th>State</th>
                <th>Children</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td>
                    <a href={`#/batches/${encodeURIComponent(batch.id)}`}>{batch.id}</a>
                  </td>
                  <td>{batch.state}</td>
                  <td>
                    {batch.job_count} / {batch.requested_count}
                  </td>
                  <td>{batch.updated_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BatchDetails({ batch }: { batch: IngestionBatchSummary }) {
  return (
    <>
      <dl>
        <dt>Batch ID</dt>
        <dd>{batch.id}</dd>
        <dt>Created</dt>
        <dd>{batch.created_at}</dd>
        <dt>Updated</dt>
        <dd>{batch.updated_at}</dd>
        <dt>Requested children</dt>
        <dd>{batch.requested_count}</dd>
        <dt>Returned children</dt>
        <dd>{batch.job_count}</dd>
        <dt>Aggregate state</dt>
        <dd>
          <span className="state">{batch.state}</span>
        </dd>
      </dl>
      <h2>State counts</h2>
      {Object.entries(batch.counts).length ? (
        <dl>
          {Object.entries(batch.counts).map(([state, count]) => (
            <Fragment key={state}>
              <dt>{state}</dt>
              <dd>{count}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p className="muted">No aggregate state counts were supplied.</p>
      )}
      <h2>Child jobs in stored order</h2>
      {batch.jobs.length ? (
        <ol className="batch-jobs">
          {batch.jobs.map((job) => (
            <li key={job.id}>
              <a href={`#/jobs/${encodeURIComponent(job.id)}`}>{job.id}</a>
              <span className="state">{job.state}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No child jobs were returned.</p>
      )}
    </>
  );
}

export function BatchPage({ id, client }: { id: string; client: OperatorApi }) {
  const [result, setResult] = useState<IngestionBatchDetail>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    void client
      .getBatch(id)
      .then((value) => {
        if (active) setResult(value);
      })
      .catch((requestError: unknown) => {
        if (active) setError(errorMessage(requestError));
      });
    return () => {
      active = false;
    };
  }, [id, client, refresh]);

  async function prepare() {
    setBusy(true);
    setError('');
    try {
      const prepared = await client.prepareBatch(id);
      setResult(prepared);
      setRefresh((value) => value + 1);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <a href="#/batches">← All batches</a>
      <h1>Batch details</h1>
      {error && <p role="alert">{error}</p>}
      <button
        className="secondary"
        disabled={busy}
        onClick={() => {
          setError('');
          setRefresh((value) => value + 1);
        }}
      >
        Refresh batch
      </button>
      <button disabled={busy} onClick={() => void prepare()}>
        {busy ? 'Preparing children…' : 'Prepare batch'}
      </button>
      <p className="batch-warning">
        Prepare runs ordinary preparation for eligible child jobs. It does not approve, finalize,
        write canonical product data, or implicitly retry failed or reviewed children. Each child
        remains authoritative for its own review and lifecycle.
      </p>
      {result ? (
        <BatchDetails batch={result.summary} />
      ) : (
        !error && <p role="status">Loading batch…</p>
      )}
    </section>
  );
}
