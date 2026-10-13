import { useState } from 'react';
import { verificationApi, type EngineeringVerificationPreview } from './api.js';
import { ReviewValue } from './ReviewValue.js';

export function EngineeringVerification({
  jobId,
  client = verificationApi,
}: {
  jobId: string;
  client?: typeof verificationApi;
}) {
  const [preview, setPreview] = useState<EngineeringVerificationPreview>();
  const [label, setLabel] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const perform = async (verify: boolean) => {
    setBusy(true);
    setError('');
    try {
      setPreview(
        verify
          ? await client.verify(jobId, preview!.snapshot, label.trim())
          : await client.preview(jobId),
      );
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Engineering verification failed.');
      // A stale or failed intent requires loading and reviewing a fresh snapshot.
      setPreview(undefined);
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article>
      <h3>Human engineering verification</h3>
      <p>
        Review the exact canonical content after promotion. Verification does not imply
        completeness; unknown and missing specifications remain unknown.
      </p>
      <button disabled={busy} onClick={() => void perform(false)}>
        Load canonical content for verification
      </button>
      {preview && (
        <>
          <p>
            Current verification:{' '}
            {preview.current ? 'verified for this exact content' : 'requires explicit verification'}
          </p>
          <p>Content digest: {preview.content_digest}</p>
          <ReviewValue value={preview.record} />
          <p>
            This action uses the trusted local operator boundary. The label is operator-supplied and
            unauthenticated.
          </p>
          <label>
            Verifier operator label
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I have reviewed and verified the exact canonical engineering content shown above.
          </label>
          <button disabled={busy || !label.trim() || !confirmed} onClick={() => void perform(true)}>
            Record explicit engineering verification
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
