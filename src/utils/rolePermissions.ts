/**
 * Role-based permission utilities
 * Determines if a user's role is read-only based on their permissions
 */

export const READ_ONLY_ROLES = ['Viewer'];

/**
 * Check if a role is read-only
 */
export function isReadOnlyRole(role: string): boolean {
  return READ_ONLY_ROLES.includes(role);
}

/**
 * Available pages for permission control
 */
export const AVAILABLE_PAGES = [
  'View All',
  'Dashboard Page',
  'Inbound Page',
  'Outbound Page',
  'Inventory Page',
  'Stock Movement Page',
  'Config Page'
];

/**
 * Check if user has access to a specific page
 * @param userPermissions - Object mapping page names to access levels
 * @param pageName - Name of the page to check
 * @returns true if user has access, false otherwise
 */
export function hasPageAccess(
  userPermissions: { [pageName: string]: string },
  pageName: string
): boolean {
  // If user has 'View All', they have access to everything
  if (userPermissions['View All']) {
    return true;
  }
  
  return !!userPermissions[pageName];
}

/**
 * Get access level for a specific page
 * @param userPermissions - Object mapping page names to access levels
 * @param pageName - Name of the page
 * @returns 'Full Access', 'Read Only', or empty string if no access
 */
export function getPageAccessLevel(
  userPermissions: { [pageName: string]: string },
  pageName: string
): string {
  // If user has 'View All', they get Full Access to everything
  if (userPermissions['View All']) {
    return userPermissions['View All'];
  }
  
  return userPermissions[pageName] || '';
}

/**
 * Check if user has full access to a page
 * @param userPermissions - Object mapping page names to access levels
 * @param pageName - Name of the page
 * @returns true if 'Full Access', false if 'Read Only' or no access
 */
export function isPageFullAccess(
  userPermissions: { [pageName: string]: string },
  pageName: string
): boolean {
  const accessLevel = getPageAccessLevel(userPermissions, pageName);
  return accessLevel === 'Full Access';
}

/**
 * Check if user has read-only access to a page
 * @param userPermissions - Object mapping page names to access levels
 * @param pageName - Name of the page
 * @returns true if 'Read Only', false otherwise
 */
export function isPageReadOnly(
  userPermissions: { [pageName: string]: string },
  pageName: string
): boolean {
  const accessLevel = getPageAccessLevel(userPermissions, pageName);
  return accessLevel === 'Read Only';
}
