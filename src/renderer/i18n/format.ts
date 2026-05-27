import i18n from './index'

export function formatDate(
  ms: number,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'short' }
): string {
  return new Intl.DateTimeFormat(i18n.language, opts).format(ms)
}

export function formatTime(
  ms: number,
  opts: Intl.DateTimeFormatOptions = { timeStyle: 'short' }
): string {
  return new Intl.DateTimeFormat(i18n.language, opts).format(ms)
}

export function formatNumber(n: number, opts: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(i18n.language, opts).format(n)
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount)
}
