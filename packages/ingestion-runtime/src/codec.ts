/** Tagged tree keeps byte buffers and present undefined properties lossless across JSON. */
type Encoded =
  | null
  | boolean
  | number
  | string
  | ['undefined']
  | ['bytes', string]
  | ['array', Encoded[]]
  | ['object', [string, Encoded][]];

const encode = (value: unknown, active: Set<object>): Encoded => {
  if (value === undefined) return ['undefined'];
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') throw new Error('Job contains a non-serializable value.');
  if (active.has(value)) throw new Error('Job contains a circular reference.');
  if (Object.prototype.toString.call(value) === '[object Uint8Array]')
    return ['bytes', Buffer.from(value as Uint8Array).toString('base64')];
  if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value))
    throw new Error('Job contains an unsupported object type.');
  active.add(value);
  const result: Encoded = Array.isArray(value)
    ? ['array', value.map((item) => encode(item, active))]
    : [
        'object',
        Object.keys(value)
          .sort()
          .map((key) => [key, encode((value as Record<string, unknown>)[key], active)]),
      ];
  active.delete(value);
  return result;
};

const decode = (value: unknown): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!Array.isArray(value)) throw new Error('Malformed job encoding.');
  if (value.length === 1 && value[0] === 'undefined') return undefined;
  if (value.length !== 2) throw new Error('Malformed job encoding.');
  if (value[0] === 'bytes' && typeof value[1] === 'string') {
    const bytes = Buffer.from(value[1], 'base64');
    if (bytes.toString('base64') !== value[1]) throw new Error('Malformed job bytes.');
    return new Uint8Array(bytes);
  }
  if (value[0] === 'array' && Array.isArray(value[1])) return value[1].map(decode);
  if (value[0] === 'object' && Array.isArray(value[1])) {
    const output: Record<string, unknown> = {};
    for (const entry of value[1]) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== 'string' ||
        entry[0] === '__proto__' ||
        Object.hasOwn(output, entry[0])
      )
        throw new Error('Malformed job object.');
      output[entry[0]] = decode(entry[1]);
    }
    return output;
  }
  throw new Error('Malformed job encoding.');
};

export const serializeJob = (value: unknown): string =>
  JSON.stringify(encode(value, new Set())) + '\n';
export const deserializeJob = (text: string): unknown => decode(JSON.parse(text) as unknown);

export const assertJsonInput = (value: unknown): void => {
  const visit = (item: unknown, active: Set<object>): void => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (
      typeof item !== 'object' ||
      (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) ||
      active.has(item)
    )
      throw new Error('Product intake must be JSON serializable.');
    active.add(item);
    for (const child of Object.values(item)) visit(child, active);
    active.delete(item);
  };
  visit(value, new Set());
};
