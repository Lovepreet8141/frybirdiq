import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { OrderNowBar } from "@/components/site/order-now-bar";
import { PreviewNotice } from "@/components/site/preview-notice";
import { ToastProvider } from "@/components/ui/toast";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex min-h-full flex-col">
        <PreviewNotice />
        <Header />
        {/* Bottom padding only where the bar shows, so it never covers the
            last thing on the page. Matches the bar's own lg:hidden. */}
        <main className="flex-1 pb-[84px] lg:pb-0">{children}</main>
        <Footer />
        <OrderNowBar />
      </div>
    </ToastProvider>
  );
}
