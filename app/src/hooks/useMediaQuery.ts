import { useEffect, useState } from "react";

/** Tracks a CSS media query in JS — only for copy that must change with
 * viewport width (e.g. "phone" vs "computer"). Layout itself should use
 * real CSS media queries, not this. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
