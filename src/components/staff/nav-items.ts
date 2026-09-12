import {
  Activity,
  ChefHat,
  ClipboardList,
  History,
  Image as ImageIcon,
  LayoutGrid,
  LayoutList,
  Layers3,
  type LucideIcon,
  Package,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck,
  UserCog,
  Users,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Path prefixes this item should NOT match even though they start with `href` — sibling pages that have their own item. */
  readonly exclude?: readonly string[];
}

export interface NavGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

export interface NavPermissions {
  readonly canSeeOrders: boolean;
  readonly canSeePos: boolean;
  readonly canSeeDeliveries: boolean;
  readonly canSeeMenu: boolean;
  readonly canSeeAnalytics: boolean;
  readonly canSeeCustomers: boolean;
  readonly canSeeStaff: boolean;
  readonly canSeeAudit: boolean;
  readonly canSeeFinance: boolean;
  readonly canSeeKitchen: boolean;
}

/**
 * Every real, live staff destination, grouped once and shared by both the
 * sidebar and the command palette — one list, so a page that exists in one
 * can never silently go missing from the other.
 *
 * Only LIVE destinations belong here. A future group (Inventory, People,
 * Finance...) is added the pass its module actually ships, by pushing one
 * more object onto this array — nothing that renders it has to change. See
 * FRYBIRD-ADMIN-ARCHITECTURE.md for what's planned and why it isn't here yet.
 */
export function buildNavGroups(permissions: NavPermissions): readonly NavGroup[] {
  const {
    canSeeOrders,
    canSeePos,
    canSeeDeliveries,
    canSeeMenu,
    canSeeAnalytics,
    canSeeCustomers,
    canSeeStaff,
    canSeeAudit,
    canSeeFinance,
    canSeeKitchen,
  } = permissions;

  const groups: NavGroup[] = [
    {
      id: "operations",
      label: "Operations",
      items: [
        ...(canSeeAnalytics
          ? [{ href: "/app/iq", label: "Overview", icon: LayoutGrid, exclude: ["/app/iq/menu", "/app/iq/live", "/app/iq/activity", "/app/iq/channels"] }]
          : []),
        ...(canSeeAnalytics ? [{ href: "/app/iq/live", label: "Live operations", icon: Activity }] : []),
        ...(canSeeAnalytics ? [{ href: "/app/iq/activity", label: "Activity", icon: History }] : []),
        ...(canSeeAnalytics ? [{ href: "/app/iq/channels", label: "Channels", icon: Store }] : []),
        ...(canSeeOrders ? [{ href: "/app/orders", label: "Orders", icon: ClipboardList }] : []),
        ...(canSeePos ? [{ href: "/app/pos", label: "POS", icon: ShoppingBag }] : []),
        ...(canSeeKitchen ? [{ href: "/app/kds", label: "Kitchen", icon: ChefHat }] : []),
        ...(canSeeDeliveries ? [{ href: "/app/deliveries", label: "Deliveries", icon: Truck }] : []),
      ],
    },
    {
      id: "menu",
      label: "Menu",
      items: canSeeMenu
        ? [
            { href: "/app/iq/menu", label: "Menu overview", icon: UtensilsCrossed },
            { href: "/app/iq/menu/products", label: "Products", icon: Package },
            { href: "/app/iq/menu/modifiers", label: "Modifiers", icon: Layers3 },
            { href: "/app/iq/menu/combos", label: "Combos", icon: LayoutList },
            { href: "/app/iq/menu/media", label: "Media", icon: ImageIcon },
            { href: "/app/iq/menu/review", label: "Review queue", icon: ClipboardList },
          ]
        : [],
    },
    {
      id: "customers",
      label: "Customers",
      items: canSeeCustomers ? [{ href: "/app/customers", label: "Customers", icon: Users }] : [],
    },
    {
      id: "finance",
      label: "Finance",
      items: canSeeFinance ? [{ href: "/app/finance", label: "Payments", icon: Wallet }] : [],
    },
    {
      id: "people",
      label: "People",
      items: canSeeStaff ? [{ href: "/app/staff", label: "Staff", icon: UserCog }] : [],
    },
    {
      id: "admin",
      label: "Admin",
      items: canSeeAudit ? [{ href: "/app/admin/audit", label: "Audit log", icon: ShieldCheck }] : [],
    },
  ];

  return groups.filter((group) => group.items.length > 0);
}
