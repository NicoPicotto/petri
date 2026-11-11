const pesoFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const numberFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** Centavos → "$ 50.000". */
export function formatPesos(cents: number): string {
  return `$ ${pesoFormat.format(cents / 100)}`;
}

export function formatPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${(x * 100).toLocaleString('es-AR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}

export function formatNumber(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return numberFormat.format(x);
}

export function formatMonth(tick: number): string {
  return `Mes ${tick} (año ${Math.floor(tick / 12)}, mes ${(tick % 12) + 1})`;
}
