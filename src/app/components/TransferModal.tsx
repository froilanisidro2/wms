'use client';

import { useState } from 'react';

interface TransferModalProps {
  isOpen: boolean;
  sourceInventory: any;
  locations: any[];
  items: any[];
  onClose: () => void;
  onTransferComplete: () => void;
}

export default function TransferModal({
  isOpen,
  sourceInventory,
  locations,
  items,
  onClose,
  onTransferComplete,
}: TransferModalProps) {
  const [destinationLocationId, setDestinationLocationId] = useState<number | ''>('');
  const [destinationLocationSearch, setDestinationLocationSearch] = useState('');
  const [showDestinationDropdown, setShowDestinationDropdown] = useState(false);
  const [quantity, setQuantity] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const getLocationName = (locId: number) => {
    return locations.find((loc) => loc.id === locId)?.location_name || 'Unknown';
  };

  const getItemName = (itemId: number) => {
    return items.find((item) => item.id === itemId)?.item_code || 'Unknown';
  };

  const handleTransfer = async () => {
    setError(null);
    setSuccess(null);

    // Validation
    if (!destinationLocationId) {
      setError('Please select a destination location');
      return;
    }

    if (!quantity || Number(quantity) <= 0) {
      setError('Please enter a valid quantity');
      return;
    }

    if (destinationLocationId === sourceInventory.location_id) {
      setError('Destination must be different from source location');
      return;
    }

    if (Number(quantity) > Number(sourceInventory.available_quantity)) {
      setError(`Insufficient available quantity. Available: ${sourceInventory.available_quantity}`);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/inventory-transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item_id: sourceInventory.item_id,
          source_location_id: sourceInventory.location_id,
          destination_location_id: Number(destinationLocationId),
          quantity: Number(quantity),
          warehouse_id: sourceInventory.warehouse_id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Transfer failed');
      }

      setSuccess('Transfer completed successfully!');
      
      // Reset form
      setDestinationLocationId('');
      setDestinationLocationSearch('');
      setQuantity('');

      // Wait a moment then close modal and refresh data
      setTimeout(() => {
        onTransferComplete();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6 text-gray-900">Transfer Inventory</h2>

        {/* Source Info */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-gray-600 font-semibold mb-2">From</p>
          <p className="text-lg font-bold text-gray-900">
            {getItemName(sourceInventory.item_id)}
          </p>
          <p className="text-sm text-gray-600 mt-1">
            Location: {getLocationName(sourceInventory.location_id)}
          </p>
          <p className="text-sm text-gray-600">
            Available: {sourceInventory.available_quantity} units (On-hand: {sourceInventory.on_hand_quantity}, Allocated: {sourceInventory.allocated_quantity})
          </p>
        </div>

        {/* Destination Location */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Destination Location *
          </label>
          
          {/* Autocomplete Location Dropdown */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search or select location..."
              value={destinationLocationSearch}
              onChange={(e) => {
                setDestinationLocationSearch(e.target.value);
                setShowDestinationDropdown(true);
              }}
              onFocus={() => setShowDestinationDropdown(true)}
              className="w-full border border-gray-300 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
            
            {/* Dropdown List */}
            {showDestinationDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50">
                {locations && locations.length > 0 ? (
                  locations
                    .filter(loc => 
                      loc.location_name.toLowerCase().includes(destinationLocationSearch.toLowerCase()) &&
                      loc.id !== sourceInventory.location_id // Exclude source location
                    )
                    .map(loc => (
                      <div
                        key={loc.id}
                        onClick={() => {
                          setDestinationLocationId(loc.id);
                          setDestinationLocationSearch(loc.location_name);
                          setShowDestinationDropdown(false);
                        }}
                        className="px-4 py-2.5 hover:bg-blue-100 cursor-pointer text-sm border-b last:border-b-0"
                      >
                        {loc.location_name}
                      </div>
                    ))
                ) : (
                  <div className="px-4 py-2.5 text-sm text-gray-500">No locations available</div>
                )}
              </div>
            )}
          </div>
          
          {destinationLocationId && (
            <p className="text-xs text-green-600 mt-1">✓ Location selected: {destinationLocationSearch}</p>
          )}
        </div>

        {/* Quantity */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Quantity to Transfer *
          </label>
          <input
            type="number"
            min="1"
            max={sourceInventory.available_quantity}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : '')}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter quantity"
          />
          <p className="text-xs text-gray-500 mt-1">
            Max available: {sourceInventory.available_quantity} units
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            {success}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-4">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-semibold hover:bg-gray-50 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleTransfer}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? 'Transferring...' : 'Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}
