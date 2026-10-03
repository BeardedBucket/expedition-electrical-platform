export function ReviewValue({ value }: { value: unknown }) {
  if (value === undefined) return <span>Unknown / not available</span>;
  if (value === null) return <span>Explicit null</span>;
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((item, index) => (
          <li key={index}>
            <ReviewValue value={item} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === 'object')
    return (
      <dl>
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              <ReviewValue value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span>{String(value)}</span>;
}

export function SourceLink({ uri }: { uri?: string }) {
  return uri && /^https?:\/\//i.test(uri) ? (
    <a href={uri} target="_blank" rel="noopener noreferrer">
      {uri}
    </a>
  ) : (
    <span>Source URI unavailable</span>
  );
}
