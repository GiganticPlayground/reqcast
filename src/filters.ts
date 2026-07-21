import { FiltersConfig } from './config-schema.js';

/** Tiny glob → RegExp. `**` matches across segments (incl. `/`); `*` matches within a segment. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export function makeFilter(
  filters?: FiltersConfig,
): (info: { method: string; path: string }) => boolean {
  if (!filters) return () => true;
  const includes = filters.includePaths?.map(globToRegExp);
  const excludes = filters.excludePaths?.map(globToRegExp);
  const methods = filters.methods?.map((m) => m.toUpperCase());
  return ({ method, path }) => {
    if (methods && !methods.includes(method.toUpperCase())) return false;
    if (excludes?.some((re) => re.test(path))) return false;
    if (includes && !includes.some((re) => re.test(path))) return false;
    return true;
  };
}
