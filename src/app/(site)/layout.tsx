import "../(home)/frybird-home.css";
import { HomeNav } from "@/components/home/nav";
import { Footer } from "@/components/site/footer";
import { PreviewNotice } from "@/components/site/preview-notice";
import { ToastProvider } from "@/components/ui/toast";
import { getCustomer } from "@/lib/customer";

/**
 * Every customer route except the homepage itself: menu, item, cart,
 * checkout, account, sign-in, order tracking. Shares `HomeNav` — the same
 * fixed dark header component the homepage uses — with `(home)/layout.tsx`,
 * so the header is one implementation, not two that can drift apart. `.fb-nav`
 * is `position: fixed`, so the content column reserves `--nav-h` of top
 * padding rather than sitting underneath it.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const customer = await getCustomer();
  const signedIn = customer !== null;

  return (
    <ToastProvider>
      <HomeNav signedIn={signedIn} />
      <div className="flex min-h-full flex-col pt-[var(--nav-h)]">
        <PreviewNotice />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    </ToastProvider>
  );
}
