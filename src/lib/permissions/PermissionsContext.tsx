"use client";

// A view-only permission (e.g. "users.view" but not "users.edit") should
// never leave an action button clickable-then-rejected - the server route
// was always the real gate, but the UI has to agree with it or a viewer
// sees Edit/Deactivate/Delete buttons that only ever 403. AppLayout (a
// Server Component, already holding `user.permissions` from getCurrentUser())
// provides this once at the top of the authenticated tree; any client page
// underneath reads it with usePermissions() instead of re-fetching
// /api/auth/me itself.
import { createContext, useContext } from "react";

const PermissionsContext = createContext<string[]>([]);

export function PermissionsProvider({ permissions, children }: { permissions: string[]; children: React.ReactNode }) {
  return <PermissionsContext.Provider value={permissions}>{children}</PermissionsContext.Provider>;
}

// Returns the raw permission-key array for the logged-in user - pair with
// hasPermission()/hasAnyPermission() from ./registry to check a specific
// page.action, the same functions Server Components already use.
export function usePermissions(): string[] {
  return useContext(PermissionsContext);
}
