"use client";

import React from 'react';

export function DateTimeDisplay() {
  const [mounted, setMounted] = React.useState(false);
  const [dateTime, setDateTime] = React.useState('');

  React.useEffect(() => {
    setMounted(true);
    const updateDateTime = () => {
      const now = new Date();
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      
      // Format date/time in Asia/Manila timezone (UTC+8)
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
      
      const parts = formatter.formatToParts(now);
      const dayName = parts.find(p => p.type === 'weekday')?.value || '';
      const date = parts.find(p => p.type === 'day')?.value || '';
      const month = parts.find(p => p.type === 'month')?.value || '';
      const year = parts.find(p => p.type === 'year')?.value || '';
      
      setDateTime(`${dayName}, ${date} ${month} ${year}`);
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  if (!mounted) return null;
  return <div className="whitespace-nowrap">{dateTime}</div>;
}
