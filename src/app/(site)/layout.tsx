import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { PreviewNotice } from "@/components/site/preview-notice";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <PreviewNotice />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
