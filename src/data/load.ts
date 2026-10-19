export async function loadData<T>(
  path: string,
  parse: (raw: unknown) => T,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchFn(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return parse(await res.json());
}

export function showDemoError(section: HTMLElement): void {
  if (section.querySelector('.demo-error')) return;
  const p = document.createElement('p');
  p.className = 'demo-error';
  p.textContent = "Couldn't load this demo. The explanation above still holds.";
  section.append(p);
}
