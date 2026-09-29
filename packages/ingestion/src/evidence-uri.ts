/** Read-only acquisition eligibility, not source authority or semantic confidence.
 * Match explicit action tokens, not substrings like 'charge-controller' or every
 * query URL. Export/download and technical query parameters remain eligible.
 * The denied set comes from Wave 1 commerce/wiki actions and ordinary account
 * mutation endpoints. Reconsider it when a legitimate technical endpoint collides;
 * never bypass an action boundary with a manufacturer-specific code exception.
 */
export const isReadOnlyEvidenceUri = (uri: string): boolean => {
  try {
    const url = new URL(uri);
    const denied = new Set([
      'cart',
      'checkout',
      'purchase',
      'login',
      'logout',
      'signin',
      'signout',
      'register',
      'edit',
      'delete',
      'remove',
      'save',
      'submit',
      'backlink',
      'index',
    ]);
    const segments = decodeURIComponent(url.pathname).toLowerCase().split('/').filter(Boolean);
    if (
      segments.some(
        (s) =>
          (denied.has(s) && !['index', 'backlink'].includes(s)) ||
          /^(?:add|remove)[-_]to[-_]cart$/.test(s),
      )
    )
      return false;
    for (const [key, value] of url.searchParams) {
      const name = key.toLowerCase().replaceAll('_', '-');
      if (['add-to-cart', 'remove-item', 'buy', 'purchase', 'checkout', 'message'].includes(name))
        return false;
      if (
        ['do', 'action', 'task'].includes(name) &&
        (denied.has(value.toLowerCase()) ||
          /^(?:add|remove)[-_](?:to[-_])?cart$/i.test(value) ||
          // Wiki extensions namespace their action after __. A namespaced
          // mutation verb still denotes an action; export/download verbs do not.
          /__(?:add|remove|delete|save|edit)[a-z_-]*$/i.test(value))
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
};
