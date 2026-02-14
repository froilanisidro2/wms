"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { DateTimeDisplay } from "./DateTimeDisplay";
import { CurrentUserDisplay } from "./CurrentUserDisplay";
import { useAuth } from "@/lib/auth-context";
import { getPostgRESTUrl } from "@/utils/apiUrlBuilder";

const navItems = [
  { name: "Dashboard", path: "/dashboard", pageName: "Dashboard Page" },
  { name: "Inbound", path: "/inbound", pageName: "Inbound Page" },
  { name: "Outbound", path: "/outbound", pageName: "Outbound Page" },
  { name: "Inventory", path: "/inventory", pageName: "Inventory Page" },
  { name: "Stock Movement", path: "/stock-movement", pageName: "Stock Movement Page" },
  { name: "Config", path: "/config", pageName: "Config Page" },
];

export function Navigation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading, hasAccess } = useAuth();
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedWarehouse, setSelectedWarehouse] = useState<number | null>(null);
  const [years, setYears] = useState<number[]>([]);
  const [userWarehouses, setUserWarehouses] = useState<any[]>([]);
  const [warehouseDetails, setWarehouseDetails] = useState<Map<number, any>>(new Map());
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Show year selector for transaction pages and dashboard
  const showYearSelector = pathname && ['/dashboard', '/inbound', '/outbound', '/inventory', '/stock-movement'].includes(pathname);

  useEffect(() => {
    setMounted(true);
    // Generate list of years: current year + 4 previous years
    const currentYear = new Date().getFullYear();
    const yearList = Array.from({ length: 5 }, (_, i) => currentYear - i).sort((a, b) => b - a);
    setYears(yearList);

    // Read year and warehouse from URL params
    let urlWarehouse = null;
    if (searchParams) {
      const urlYear = searchParams.get('year');
      if (urlYear) {
        setSelectedYear(parseInt(urlYear));
      }
      urlWarehouse = searchParams.get('warehouse');
      if (urlWarehouse) {
        setSelectedWarehouse(parseInt(urlWarehouse));
      }
    }

    // Only fetch if user is loaded and authenticated
    if (!loading && user?.id) {
      const fetchUserWarehouses = async () => {
        try {
          // Call Next.js API route instead of direct PostgREST
          const url = `/api/user-warehouses?user_id=eq.${user.id}`;
          console.log('[Navigation] Fetching warehouses from:', url);
          const res = await fetch(url);
          console.log('[Navigation] Warehouse fetch response status:', res.status);
          if (res.ok) {
            const data = await res.json();
            console.log('[Navigation] User warehouses loaded:', data);
            setUserWarehouses(data);
            
            // Fetch warehouse master data for display via API route
            try {
              const warehouseRes = await fetch('/api/config-records');
              if (warehouseRes.ok) {
                const warehouseData = await warehouseRes.json();
                const allWarehouses = warehouseData.warehouses || [];
                console.log('[Navigation] All warehouses fetched:', allWarehouses);
                console.log('[Navigation] Sample warehouse structure:', allWarehouses[0]);
                
                // Build map for quick lookup
                const warehouseMap = new Map();
                allWarehouses.forEach((w: any) => {
                  const code = w.warehouse_code || w.code || '';
                  const name = w.warehouse_name || w.name || '';
                  console.log(`[Navigation] Mapping warehouse ID ${w.id}: code="${code}", name="${name}"`);
                  warehouseMap.set(w.id, {
                    id: w.id,
                    code: code.trim(),
                    name: name
                  });
                });
                console.log('[Navigation] Warehouse map built:', Array.from(warehouseMap.entries()));
                setWarehouseDetails(warehouseMap);
              }
            } catch (err) {
              console.warn('[Navigation] Failed to fetch warehouse details:', err);
            }
            
            // Auto-select first warehouse if user has assigned warehouses and none is currently selected
            if (data.length > 0 && !urlWarehouse) {
              setSelectedWarehouse(data[0].warehouse_id);
            }
          } else {
            console.warn('[Navigation] Failed to fetch warehouses, status:', res.status);
          }
        } catch (err) {
          console.error('Failed to fetch user warehouses:', err);
        }
      };
      fetchUserWarehouses();
    }
  }, [searchParams, user?.id, loading]);

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    // Update URL with year parameter while preserving other params
    if (pathname && searchParams) {
      const newSearchParams = new URLSearchParams(searchParams.toString());
      newSearchParams.set('year', year.toString());
      window.history.replaceState(null, '', `${pathname}?${newSearchParams.toString()}`);
    }
  };

  const handleWarehouseChange = (warehouseId: number) => {
    setSelectedWarehouse(warehouseId);
    // Update URL with warehouse parameter while preserving other params
    if (pathname && searchParams) {
      const newSearchParams = new URLSearchParams(searchParams.toString());
      newSearchParams.set('warehouse', warehouseId.toString());
      window.history.replaceState(null, '', `${pathname}?${newSearchParams.toString()}`);
    }
  };

  if (!mounted) return null;

  return (
    <nav className="text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4 md:gap-6 p-2 sm:p-3 md:p-4 flex-wrap" style={{ backgroundColor: '#008ecc' }}>
      {/* Navigation Links */}
      <div className="hidden md:flex gap-2 lg:gap-6 flex-wrap">
        {navItems.map((item) => {
          const isActive = pathname === item.path;
          const hasPageAccess = hasAccess(item.pageName);
          
          // Hide item if user doesn't have access to the page
          if (!hasPageAccess) {
            return null;
          }
          
          // Build href with preserved warehouse and year parameters
          let href = item.path;
          if (searchParams) {
            const params = new URLSearchParams(searchParams.toString());
            if (params.has('year') || params.has('warehouse')) {
              href = `${item.path}?${params.toString()}`;
            }
          }
          
          return (
            <Link
              key={item.path}
              href={href}
              className={`font-semibold text-sm lg:text-base hover:opacity-80 pb-2 border-b-2 transition ${
                isActive ? 'border-white' : 'border-transparent'
              }`}
            >
              {item.name}
            </Link>
          );
        })}
      </div>

      {/* Mobile Menu Button */}
      <button 
        className="md:hidden text-white font-bold text-lg"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label="Toggle menu"
      >
        ☰
      </button>

      {/* Selectors */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap w-full md:w-auto text-xs sm:text-sm">
        {showYearSelector && (
          <div className="flex items-center gap-1 sm:gap-2">
            <label className="font-semibold whitespace-nowrap">Records of:</label>
            <select 
              value={selectedYear} 
              onChange={(e) => handleYearChange(parseInt(e.target.value))}
              className="px-2 sm:px-3 py-1 rounded text-black font-semibold border border-gray-300 focus:outline-none focus:border-white bg-white text-xs sm:text-sm"
              aria-label="Select year"
            >
              {years.map(year => (
              <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
        )}
        {showYearSelector && (
          <div className="flex items-center gap-1 sm:gap-2">
            <label className="font-semibold whitespace-nowrap">Warehouse:</label>
            <select 
              value={selectedWarehouse || ''} 
              onChange={(e) => handleWarehouseChange(parseInt(e.target.value))}
              className="px-2 sm:px-3 py-1 rounded text-black font-semibold border border-gray-300 focus:outline-none focus:border-white bg-white text-xs sm:text-sm"
              aria-label="Select warehouse"
            >
              {userWarehouses.length > 0 ? (
                userWarehouses.map(uw => {
                  const details = warehouseDetails.get(uw.warehouse_id);
                  let displayText = '';
                  
                  // Priority: warehouse_code > warehouse_name first 10 chars > WH ID
                  if (details?.code && details.code.trim().length > 0) {
                    displayText = details.code.trim().toUpperCase();
                  } else if (details?.name && details.name.trim().length > 0) {
                    displayText = details.name.substring(0, 10).trim().toUpperCase();
                  } else {
                    displayText = `WH-${uw.warehouse_id}`;
                  }
                  
                  const tooltipText = details?.name ? `${details.name} (ID: ${uw.warehouse_id})` : `Warehouse ${uw.warehouse_id}`;
                  
                  console.log(`[Navigation] Rendering option for WH ${uw.warehouse_id}: display="${displayText}", details=`, details);
                  
                  return (
                    <option key={uw.warehouse_id} value={uw.warehouse_id} title={tooltipText}>{displayText}</option>
                  );
                })
              ) : (
                <option disabled>No WH</option>
              )}
            </select>
          </div>
        )}
        <div className="border-l border-white pl-2 sm:pl-3">
          <DateTimeDisplay />
        </div>
        <div className="border-l border-white pl-2 sm:pl-3">
          <CurrentUserDisplay />
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden w-full flex flex-col gap-2 pt-2 border-t border-white mt-2">
          {navItems.map((item) => {
            const isActive = pathname === item.path;
            const hasPageAccess = hasAccess(item.pageName);
            
            if (!hasPageAccess) return null;
            
            let href = item.path;
            if (searchParams) {
              const params = new URLSearchParams(searchParams.toString());
              if (params.has('year') || params.has('warehouse')) {
                href = `${item.path}?${params.toString()}`;
              }
            }
            
            return (
              <Link
                key={item.path}
                href={href}
                className={`font-semibold text-sm hover:opacity-80 py-2 px-2 transition ${
                  isActive ? 'bg-white bg-opacity-20 rounded' : ''
                }`}
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.name}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
