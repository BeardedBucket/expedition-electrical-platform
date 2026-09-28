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
