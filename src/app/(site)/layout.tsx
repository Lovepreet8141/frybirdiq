import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { PreviewNotice } from "@/components/site/preview-notice";
import { ToastProvider } from "@/components/ui/toast";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex min-h-full flex-col">
        <PreviewNotice />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    </ToastProvider>
  );
}
