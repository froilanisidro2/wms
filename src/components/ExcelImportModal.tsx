/**
 * Excel Import Modal Component
 * Reusable modal for importing data from Excel files
 */

import React, { useState, useRef } from 'react';
import { downloadTemplate } from '@/utils/excelTemplateGenerator';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (file: File) => Promise<void>;
  tabName: string;
  tabKey?: string;
  isLoading?: boolean;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
  tabName,
  tabKey = tabName.toLowerCase(),
  isLoading = false,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      setError('Please select a valid Excel file (.xlsx, .xls, or .csv)');
      return;
    }

    setSelectedFile(file);
    setError(null);
  };

  const handleImport = async () => {
    if (!selectedFile) {
      setError('Please select a file first');
      return;
    }

    try {
      setError(null);
      setProgress(0);
      await onImport(selectedFile);
      setProgress(100);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setTimeout(onClose, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setProgress(0);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Import {tabName}</h2>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Template Download Button */}
        <div className="mb-4">
          <button
            onClick={() => downloadTemplate(tabKey)}
            className="w-full px-4 py-2 border border-blue-600 text-blue-600 rounded-lg font-semibold hover:bg-blue-50 transition text-sm"
          >
            📄 Download Template
          </button>
          <p className="text-xs text-gray-600 mt-1 text-center">
            Download a sample file to see the required format
          </p>
        </div>

        {/* File Selection */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Select Excel File
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileSelect}
            disabled={isLoading}
            className="w-full border-2 border-dashed border-gray-300 rounded-lg px-4 py-6 text-center hover:border-blue-500 focus:outline-none disabled:opacity-50 cursor-pointer"
          />
          {selectedFile && (
            <p className="text-sm text-green-600 mt-2">
              ✓ {selectedFile.name} selected
            </p>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Progress Bar */}
        {isLoading && (
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-gray-700">
                Importing...
              </span>
              <span className="text-sm text-gray-600">{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-gray-700">
          <p className="font-semibold mb-1">📋 File Requirements:</p>
          <ul className="text-xs list-disc list-inside space-y-1">
            <li>Format: .xlsx, .xls, or .csv</li>
            <li>First row should contain column headers</li>
            <li>Use standard column names (Item Code, Vendor Name, etc.)</li>
            <li>Download the template to see the correct format</li>
          </ul>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!selectedFile || isLoading}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {isLoading ? '⟳ Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
};
