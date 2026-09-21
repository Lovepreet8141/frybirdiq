import { Check } from "lucide-react";
import { Panel, PanelBody, PanelHeader } from "@/components/iq/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLES, PERMISSIONS, permissionsFor, type Permission, type Role } from "@/domain/permissions";

/**
 * A human label and group for every permission, so the matrix reads like a
 * sentence instead of a schema. This is copy only — it never decides who
 * holds what; `permissionsFor` (read live, below) is the only source of
 * that. `Record<Permission, ...>` keeps this exhaustive: add a permission to
 * `domain/permissions.ts` without a line here and the build fails, so this
 * page can never silently fall behind the real permission list.
 */
const PERMISSION_INFO: Record<Permission, { readonly group: string; readonly label: string }> = {
  "orders.view": { group: "Orders", label: "View orders" },
  "orders.create": { group: "Orders", label: "Create orders" },
  "orders.update": { group: "Orders", label: "Update an order" },
  "orders.cancel": { group: "Orders", label: "Cancel / decline an order" },
  "orders.refund": { group: "Orders", label: "Refund" },
  "orders.discount": { group: "Orders", label: "Apply a discount" },
  "kitchen.view": { group: "Kitchen", label: "View the kitchen display" },
  "kitchen.update": { group: "Kitchen", label: "Update ticket status" },
  "delivery.view": { group: "Delivery", label: "View deliveries" },
  "delivery.complete": { group: "Delivery", label: "Complete a delivery" },
  "delivery.assign": { group: "Delivery", label: "Assign a rider to a delivery" },
  "delivery.take": { group: "Delivery", label: "Take an available delivery" },
  "menu.view": { group: "Menu", label: "View the menu" },
  "menu.edit": { group: "Menu", label: "Edit the menu" },
  "menu.price": { group: "Menu", label: "Change prices" },
  "menu.publish": { group: "Menu", label: "Publish a menu draft" },
  "inventory.view": { group: "Inventory", label: "View inventory" },
  "inventory.adjust": { group: "Inventory", label: "Adjust stock" },
  "inventory.waste": { group: "Inventory", label: "Record waste" },
  "purchasing.manage": { group: "Inventory", label: "Manage purchasing" },
  "recipes.view": { group: "Inventory", label: "View recipes" },
  "recipes.edit": { group: "Inventory", label: "Edit recipes" },
  "customers.view": { group: "Customers", label: "View customers" },
  "customers.edit": { group: "Customers", label: "Edit customers" },
  "promotions.manage": { group: "Customers", label: "Manage promotions" },
  "analytics.view": { group: "Reporting", label: "View analytics" },
  "reports.export": { group: "Reporting", label: "Export reports" },
  "finance.view": { group: "Reporting", label: "View the payments ledger" },
  "finance.manage": { group: "Reporting", label: "Record expenses and finance" },
  "iq.approve": { group: "Reporting", label: "Approve IQ actions" },
  "iq.autopolicy.manage": { group: "Reporting", label: "Manage IQ auto policies" },
  "staff.manage": { group: "Admin", label: "Manage staff" },
  "settings.manage": { group: "Admin", label: "Manage settings" },
  "integrations.manage": { group: "Admin", label: "Manage integrations" },
  "audit.view": { group: "Admin", label: "View the audit log" },
};

/** Short column heading — the sidebar and staff table already use the full role name in prose, this is a header. */
const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  KITCHEN: "Kitchen",
  RIDER: "Rider",
  INVENTORY: "Inventory",
  ANALYST: "Analyst",
};

/**
 * Every permission down the side, every role across the top — rendered
 * straight from `domain/permissions.ts` with `permissionsFor`, the exact
 * function the server calls to authorize a request. Nothing here is
 * recomputed or approximated, so this table can never drift from what the
 * app actually enforces.
 */
export function RolesMatrix() {
  const grantedByRole = new Map<Role, ReadonlySet<Permission>>(ROLES.map((role) => [role, new Set(permissionsFor(role))]));

  // Precomputed once, outside render, so nothing mutates while JSX is being
  // produced: each row knows whether it starts a new group heading.
  const rows = PERMISSIONS.reduce<{ permission: Permission; info: (typeof PERMISSION_INFO)[Permission]; showGroup: boolean }[]>((acc, permission) => {
    const info = PERMISSION_INFO[permission];
    const previousGroup = acc.at(-1)?.info.group ?? null;
    acc.push({ permission, info, showGroup: info.group !== previousGroup });
    return acc;
  }, []);

  return (
    <Panel>
      <PanelHeader title="Permissions by role" description="Who can do what, read straight from the permission table the server enforces." />
      <PanelBody flush>
        <div className="overflow-hidden rounded-b-xl border-t border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-panel">Permission</TableHead>
                {ROLES.map((role) => (
                  <TableHead key={role} className="text-center">
                    {ROLE_LABEL[role]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ permission, info, showGroup }) => {
                return (
                  <TableRow key={permission}>
                    <TableCell className="sticky left-0 z-10 bg-panel">
                      {showGroup && <div className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">{info.group}</div>}
                      <div className="font-semibold">{info.label}</div>
                    </TableCell>
                    {ROLES.map((role) => {
                      const granted = grantedByRole.get(role)?.has(permission) ?? false;
                      return (
                        <TableCell key={role} className="text-center">
                          {granted ? (
                            <span className="inline-flex size-5 items-center justify-center rounded-full bg-gain-soft text-gain">
                              <Check className="size-3.5" aria-hidden="true" />
                              <span className="sr-only">{`${ROLE_LABEL[role]} can ${info.label.toLowerCase()}`}</span>
                            </span>
                          ) : (
                            <span aria-hidden="true" className="text-muted-foreground/40">
                              —
                            </span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </PanelBody>
    </Panel>
  );
}
