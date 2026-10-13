import { Fragment } from 'react';

export function ReviewValue({ value }: { value: unknown }) {
  if (value === undefined) return <span>Unknown / not available</span>;
  if (value === null) return <span>Explicit null</span>;
  if (Array.isArray(value))
    return (
      <ul className="review-value-list">
        {value.map((item, index) => (
          <li key={index}>
            <ReviewValue value={item} />
          </li>
        ))}
      </ul>
    );
  // Object entries span the whole available width. Recursively nesting the global two-column
  // dl grid previously allocated columns to wrapper divs and squeezed locators to one character.
  if (typeof value === 'object')
    return (
      <dl className="review-value-object">
        {Object.entries(value).map(([key, item]) => (
          <Fragment key={key}>
            <dt>{key}</dt>
            <dd>
              <ReviewValue value={item} />
            </dd>
          </Fragment>
        ))}
      </dl>
    );
  // Preserve exact text. Unbroken identifiers scroll locally instead of becoming vertical text.
  return (
    <span className="review-value-text" tabIndex={0}>
      {String(value)}
    </span>
  );
}

export function SourceLink({ uri }: { uri?: string }) {
  return uri && /^https?:\/\//i.test(uri) ? (
    <a className="technical-string" href={uri} target="_blank" rel="noopener noreferrer">
      {uri}
    </a>
  ) : (
    <span>Source URI unavailable</span>
  );
}
