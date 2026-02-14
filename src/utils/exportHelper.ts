/**
 * Export utilities for CSV download
 */

interface ExportOptions {
  filename: string;
  data: any[];
  columns?: string[];
}

/**
 * Convert data to CSV and trigger download
 */
export function downloadCSV(options: ExportOptions): void {
  const { filename, data, columns } = options;

  if (data.length === 0) {
    alert('No data to export');
    return;
  }

  // Get column headers
  const headers = columns || Object.keys(data[0]);

  // Create CSV content
  const csvContent = [
    headers.join(','),
    ...data.map(row =>
      headers.map(header => {
        const value = row[header];
        // Escape quotes and wrap in quotes if contains comma
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',')
    )
  ].join('\n');

  // Add UTF-8 BOM to fix Excel SYLK detection issue
  const BOM = '\uFEFF';
  const blobContent = BOM + csvContent;

  // Create blob and download
  const blob = new Blob([blobContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Filter data by date range
 */
export function filterByDateRange(
  data: any[],
  startDate: string,
  endDate: string,
  dateField: string = 'created_at'
): any[] {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime() + 86400000; // Include entire end date

  return data.filter(item => {
    const itemDate = new Date(item[dateField]).getTime();
    return itemDate >= start && itemDate <= end;
  });
}
