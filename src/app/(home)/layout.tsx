import "./frybird-home.css";
import { PreviewNotice } from "@/components/site/preview-notice";
import { ToastProvider } from "@/components/ui/toast";

/**
 * The homepage's own layout — deliberately separate from (site)/layout.tsx.
 * Every other customer route (menu, cart, checkout, account, order
 * tracking) keeps the existing Header/Footer via (site); this route group
 * exists so the homepage can carry the ported frybird-web navigation/
 * footer instead, without touching any other page's chrome. The homepage
 * itself (page.tsx) renders its own Nav/Footer/OrderBar/Motion — this
 * layout only provides what every customer page still needs regardless.
 */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <PreviewNotice />
      {children}
    </ToastProvider>
  );
}
