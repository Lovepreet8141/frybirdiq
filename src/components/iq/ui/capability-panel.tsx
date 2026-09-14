import { Panel, PanelBody, PanelHeader } from "./panel";
import { StatusWord } from "./signals";

export interface Capability {
  readonly name: string;
  readonly connected: boolean;
  /** What it means when connected, or which slice connects it when not. */
  readonly note: string;
}

/**
 * What a screen can and cannot tell the owner today, said beside the data.
 * A zero that was never measured is not a quantity; this names the ledger
 * that is missing and the roadmap slice that fills it, so nothing on the
 * page has to pretend.
 */
export function CapabilityPanel({ title = "What this screen knows", items, className }: { title?: string; items: readonly Capability[]; className?: string }) {
  const connected = items.filter((item) => item.connected).length;
  return (
    <Panel className={className}>
      <PanelHeader title={title} meta={`${connected} of ${items.length} connected`} />
      <PanelBody className="pt-0">
        <ul className="flex flex-col divide-y divide-border">
          {items.map((item) => (
            <li key={item.name} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
              <StatusWord tone={item.connected ? "gain" : "flag"} className="text-foreground">
                <span className="font-medium">{item.name}</span>
                <span className="text-muted-foreground">· {item.connected ? "Connected" : "Not connected"}</span>
              </StatusWord>
              <p className="pl-[15px] text-[12.5px] leading-[1.4] text-muted-foreground">{item.note}</p>
            </li>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}
