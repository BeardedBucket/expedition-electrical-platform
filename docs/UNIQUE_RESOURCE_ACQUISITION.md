# Unique resource acquisition budgeting

`max_discovered_candidates` limits distinct normalized candidate URIs globally
across seed and depth-one discovery. Its default remains 50. Normalization still
resolves relative URLs, removes fragments and normalizes default ports; it does
not add URL equivalence rules. Excluded resources also consume a discovery slot.

Admission follows the existing link comparator and child-first traversal. Seed
work does not reserve slots ahead of children. After the resource limit is full,
occurrences of already admitted URIs can still retain provenance. Candidate IDs
remain sequential in retained traversal order.

The durable candidate contract is unchanged: each retained occurrence has its
raw URI, normalized URI, source label, locator, discovery method and immediate
parent capture. Subsequent occurrences use `duplicate_uri` and reference the
owning candidate. Capture ownership still uses the existing URI map, including
redirect destinations. Equal bytes at different URIs remain content equivalence,
not URI equivalence. The global capture limit remains 20 by default.

## Bounded provenance

There was no independent duplicate provenance bound. Acquisition now keeps at
most eight sorted occurrences per normalized URI per immediate parent. Eight is
a fixed internal conservative bound, not a new public policy field. It preserves
several fragment/label/locator samples while allowing separate parent paths.
Truncation is reported in acquisition result issues.

For a discovery limit D, at most D candidate parents expand (and never their
children). Retained entries are bounded by `8 * D * (D + 1)`, regardless of raw
anchor count. Each pending parent batch retains at most D new URIs plus D already
admitted URIs, each with at most eight occurrences. HTTP body bounds and existing
parsing behavior remain unchanged; the temporary parsed discovery list is still
bounded by captured input size, rather than by D.

## Prior accounting defect

`discoverLinks` normalized occurrences before sorting. Seed discovery then sliced
the occurrence array to D, and child discovery sliced to D minus retained entry
count. The work loop stopped at D retained entries. Only inside that loop did
`byUri` classify duplicates. Consequently duplicate fragment occurrences consumed
slots before duplicate classification, crowding out distinct documents.

Existing acquisition tests require separate fragment and direct/child entries.
Contract validation requires duplicate owner IDs to reference retained candidates.
Admin presentation displays duplicate selection status; production preparation
processes only entries with actual authoritative captures. These dependencies are
preserved without a new graph or candidate schema.

## Streaming transport time policy

The shared HTTP capture adapter separates three configurable boundaries on
`CaptureRequest`. `timeout_ms` defaults to 10,000 ms and bounds DNS, redirect
resolution, and final response headers collectively. Once the final response
starts, `body_idle_timeout_ms` defaults to 10,000 ms; each nonempty body chunk
resets that clock. Text and binary bodies use the same progress rule.
`body_timeout_ms` defaults to 120,000 ms and caps the complete body transfer
independently of progress. All three values must be positive safe integers no
larger than 2,147,483,647 ms (the timer implementation range).

The two-minute body cap permits a near-32,000,000-byte resource at about
267,000 bytes/second while bounding a trickle stream. With the unchanged 20
candidate-attempt budget plus the seed, the default transport waits are bounded
by 21 * (10 + 120) seconds, excluding local processing. There is no separate
acquisition-wide wall-clock deadline or implicit retry. The default balances
ordinary technical-document throughput against finite sequential worker
occupancy; it is not derived from a particular publisher's download duration.

Byte policies remain independent: text/HTML 2,000,000 bytes, PDF 32,000,000,
other binary 4,000,000, absolute resource ceiling 32,000,000, and acquisition
observed-byte allowance 40,000,000. These are the existing decimal-byte values.
Content-Length only enables early rejection. Streamed bytes, including the
size-crossing chunk and bytes preceding a timeout, remain authoritative for
accounting. Partial bodies never produce captures, content digests, or retained
snapshots. The independent PDF extraction-input ceiling is now intentionally
aligned at 32,000,000 bytes; HTML retains its 8,388,608-byte gate. See
[bounded extraction architecture](ARCHITECTURE.md#bounded-source-capture-bytes)
for parser ownership, cleanup, and remaining output limits.

Timeouts and external cancellation remain `failed` captures with the existing
`aborted` reason code; reason messages distinguish response-start, inactivity,
absolute transfer timeout, and external abort. Genuine transport exceptions
remain `network_error`. Terminal abort prevents accepting later chunks. Timers
and abort listeners are removed on every exit; unsuccessful readers are
cancelled and all acquired reader locks are released. Cancellation rejection or
non-settlement does not replace the original failure or hold the worker open.
One failed candidate remains isolated and later candidates continue under the
existing resource, attempt, byte, and ordering policies.

Fake-clock offline regressions establish deterministic timing and containment.
Live network acceptance is separate evidence about current publisher behavior,
not part of the normal unit suite or proof of a reviewed product fact.
