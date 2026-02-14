/**
 * Timezone Helper Utilities
 * Provides consistent Asia/Manila (UTC+8) timezone handling across the application
 */

const TIMEZONE = 'Asia/Manila';

/**
 * Format a date/time string to Asia/Manila timezone
 * @param date - Date object or date string
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date/time string
 */
export function formatToManilaTime(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: TIMEZONE
  }
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: TIMEZONE
  }).format(dateObj);
}

/**
 * Format a date/time for display (short format)
 * @param date - Date object or date string
 * @returns Formatted date/time string (e.g., "12/24/2025, 10:30:45 AM")
 */
export function formatManilaTimeShort(date: Date | string): string {
  return formatToManilaTime(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: TIMEZONE
  });
}

/**
 * Format a date only (no time)
 * @param date - Date object or date string
 * @returns Formatted date string (e.g., "12/24/2025")
 */
export function formatManilaDate(date: Date | string): string {
  return formatToManilaTime(date, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: TIMEZONE
  });
}

/**
 * Get date in YYYY-MM-DD format for HTML date inputs
 * @param date - Date object or date string
 * @returns Date string in YYYY-MM-DD format (e.g., "2025-12-24")
 */
export function getManilaDateForInput(date: Date | string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(dateObj);
}

/**
 * Format time only
 * @param date - Date object or date string
 * @returns Formatted time string (e.g., "10:30:45 AM")
 */
export function formatManilaTimeOnly(date: Date | string): string {
  return formatToManilaTime(date, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: TIMEZONE
  });
}

/**
 * Get current time in Asia/Manila timezone
 * @returns Current date/time formatted string
 */
export function getCurrentManilaTime(): string {
  return formatToManilaTime(new Date());
}

/**
 * Get current date in Asia/Manila timezone
 * @returns Current date formatted string
 */
export function getCurrentManilaDate(): string {
  return formatManilaDate(new Date());
}
