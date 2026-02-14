'use client';

import { useState } from 'react';

interface DateRangeSelectorProps {
  onApply: (startDate: string, endDate: string) => void;
  disabled?: boolean;
}

export default function DateRangeSelector({ onApply, disabled = false }: DateRangeSelectorProps) {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);

  const handleApply = () => {
    onApply(startDate, endDate);
  };

  return (
    <div className="flex items-center gap-3 bg-white p-3 rounded-lg border border-gray-300">
      <label className="text-sm font-semibold text-gray-700">Date Range:</label>
      
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          disabled={disabled}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <span className="text-gray-600 text-sm">to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          disabled={disabled}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
      </div>

      <button
        onClick={handleApply}
        disabled={disabled}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm"
      >
        Apply
      </button>
    </div>
  );
}
