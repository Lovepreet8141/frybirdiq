import { Gift, Percent } from "lucide-react";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { getCustomer } from "@/lib/customer";
import { isLoyaltyEnabled, pointsEarned, pointsValue } from "@/lib/loyalty";
import { getLoyaltyConfig, getStampConfig } from "@/lib/loyalty/config";
import { isStampRewardEnabled, stampsRequired } from "@/lib/loyalty/stamps";
import { formatBps, formatINR, fromRupees } from "@/lib/money";
import { cn } from "@/lib/utils";
import { StampCard } from "./stamp-card";

/**
 * Two loyalty programs, told straight, with real numbers.
 *
 * Every figure here — the earn rate, the illustrative point totals, a signed-
 * in visitor's own balance and stamp count — is read from the organization
 * and the customer row. §33's rule for the ordering AI holds for marketing
 * copy too: nothing on this page is a number nobody can look up.
 */
export async function LoyaltySection() {
  const [loyalty, stampConfig, customer] = await Promise.all([getLoyaltyConfig(), getStampConfig(), getCustomer()]);

  const pointsOn = isLoyaltyEnabled(loyalty);
  const stampsOn = isStampRewardEnabled(stampConfig);
  if (!pointsOn && !stampsOn) return null;

  const bothOn = pointsOn && stampsOn;
  const required = stampsOn ? stampsRequired(stampConfig) : 0;

  return (
    <section id="loyalty" aria-labelledby="loyalty-heading" className="border-b border-border bg-[var(--cream-2)]">
      <div className="mx-auto w-full max-w-6xl px-[var(--gutter)] py-16 sm:py-20">
        <Reveal>
          <h2
            id="loyalty-heading"
            className="text-center font-heading text-[clamp(2rem,6vw,3.4rem)] font-black italic leading-none tracking-[-0.03em] text-primary"
          >
            Ordering here pays you back
          </h2>
        </Reveal>
        <Reveal delay={0.06}>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            {bothOn
              ? "Two rewards, running at the same time on every order."
              : "One reward, running on every order."}
          </p>
        </Reveal>

        <Stagger className={cn("mx-auto mt-10 grid max-w-3xl gap-6", bothOn && "lg:max-w-none lg:grid-cols-2")}>
          {pointsOn && (
            <StaggerItem>
              <div className="flex h-full flex-col rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] p-6 shadow-[6px_6px_0_var(--red)] sm:p-8">
                <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Percent className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-heading text-xl font-extrabold">
                  {formatBps(loyalty.earnBps, 0)} back, every order
                </h3>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Points land the moment you pay. Spend them on anything, any time — no minimum order{loyalty.minRedeemPoints > 0 ? ` once you've got ${loyalty.minRedeemPoints}` : ""}.
                </p>

                {customer ? (
                  <div className="mt-6 rounded-lg bg-secondary px-4 py-3">
                    <p className="tabular font-heading text-2xl font-bold">
                      {customer.points} <span className="text-sm font-semibold text-muted-foreground">points</span>
                    </p>
                    <p className="tabular mt-0.5 text-sm text-muted-foreground">
                      {customer.points > 0
                        ? `Worth ${formatINR(pointsValue(customer.points, loyalty))} right now.`
                        : "Your first order starts the balance."}
                    </p>
                  </div>
                ) : (
                  <dl className="mt-6 flex flex-col gap-2 border-t border-border pt-4 text-sm">
                    {["199", "399", "999"].map((rupees) => {
                      const earned = pointsEarned(fromRupees(rupees), loyalty);
                      return (
                        <div key={rupees} className="flex items-baseline justify-between gap-4">
                          <dt className="tabular text-muted-foreground">Order {formatINR(fromRupees(rupees))}</dt>
                          <dd className="tabular font-semibold">
                            +{earned} pts <span className="font-normal text-muted-foreground">({formatINR(pointsValue(earned, loyalty))})</span>
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
              </div>
            </StaggerItem>
          )}

          {stampsOn && (
            <StaggerItem>
              <div className="flex h-full flex-col rounded-xl border-[2.5px] border-[var(--ink)] bg-[var(--cream-hi)] p-6 shadow-[6px_6px_0_var(--red)] sm:p-8">
                <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Gift className="size-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-heading text-xl font-extrabold">
                  Buy {required}, the {stampConfig.goal}
                  <sup>th</sup> is free
                </h3>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {customer && customer.stampCount >= required
                    ? "Stamped in full — your next order's cheapest item is free, taken off automatically."
                    : "One stamp per order, whatever it costs. On the free one, your cheapest item comes off the bill by itself — nothing to redeem."}
                </p>

                <StampCard
                  goal={stampConfig.goal}
                  count={customer?.stampCount ?? 0}
                  personal={customer !== null}
                  className="mt-6"
                />

                {customer && customer.stampCount < required && (
                  <p className="tabular mt-4 text-sm text-muted-foreground">
                    {required - customer.stampCount} more order{required - customer.stampCount === 1 ? "" : "s"} to go.
                  </p>
                )}
              </div>
            </StaggerItem>
          )}
        </Stagger>
      </div>
    </section>
  );
}
