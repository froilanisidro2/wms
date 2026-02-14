import React from 'react';
import QRCode from 'react-qr-code';

export function ASNBarcode({ value }: { value: string }) {
  if (!value) return null;
  return (
    <div style={{ background: '#fff', padding: '8px', borderRadius: '8px', display: 'inline-block' }}>
      <QRCode value={value} size={128} />
      <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '0.9em' }}>{value}</div>
    </div>
  );
}
