import { Panel, PanelBody, PanelHeader, StatusWord } from "@/components/iq/ui";

/**
 * What Inventory can and cannot tell the owner today, said plainly beside
 * the data. A screen that shows "0 g on hand" for every ingredient looks
 * like a stocked kitchen with nothing in it; this says the ledger is not
 * connected, and which slice connects it (docs/ROADMAP.md, Phase 3).
 */
const CAPABILITIES: readonly { readonly name: string; readonly connected: boolean; readonly note: string }[] = [
  { name: "Ingredients and suppliers", connected: true, note: "Master data, editable under purchasing" },
  { name: "Price records and usable cost", connected: true, note: "Every price recorded moves the ingredient's cost" },
  { name: "Stock on hand and movements", connected: false, note: "Needs receive, adjust and count — roadmap 3.2" },
  { name: "Waste log", connected: false, note: "Roadmap 3.3" },
  { name: "Consumption on order", connected: false, note: "Roadmap 3.4, after recipes" },
  { name: "Purchase orders and receiving", connected: false, note: "Roadmap 3.7" },
];

export function CapabilityPanel() {
  const connected = CAPABILITIES.filter((item) => item.connected).length;
  return (
    <Panel>
      <PanelHeader title="What this screen knows" meta={`${connected} of ${CAPABILITIES.length} connected`} />
      <PanelBody className="pt-0">
        <ul className="flex flex-col divide-y divide-border">
          {CAPABILITIES.map((item) => (
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
