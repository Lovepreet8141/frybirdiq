"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";

import { submitFranchiseInquiry } from "@/lib/home/franchise-actions";
import { franchiseInquirySchema } from "@/lib/home/franchise-schema";

type FieldName = "name" | "city" | "phone" | "message";
type Status = { tone: "idle" } | { tone: "sending" } | { tone: "success" } | { tone: "error"; text: string };

const FIELDS: { name: FieldName; label: string; placeholder: string; type: string }[] = [
  { name: "name", label: "Name", placeholder: "Your name", type: "text" },
  { name: "city", label: "City", placeholder: "Where you want to open", type: "text" },
  { name: "phone", label: "Phone", placeholder: "+91", type: "tel" },
];

/**
 * Ported from frybird-web's src/components/site/franchise-form.tsx. Same
 * markup, same client-side pre-validation for instant field errors, same
 * honeypot field. The one change is the submit call: a plain Server Action
 * (submitFranchiseInquiry) instead of a TanStack createServerFn — same
 * Zod schema underneath either way.
 */
export function FranchiseForm() {
  const [status, setStatus] = useState<Status>({ tone: "idle" });
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = Object.fromEntries(new FormData(form).entries());
    const parsed = franchiseInquirySchema.safeParse(raw);
    if (!parsed.success) {
      const next: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !(key in next)) next[key as FieldName] = issue.message;
      }
      setErrors(next);
      setStatus({ tone: "error", text: "Check the highlighted fields." });
      return;
    }
    setErrors({});
    setStatus({ tone: "sending" });
    startTransition(async () => {
      try {
        const result = await submitFranchiseInquiry(parsed.data);
        if (result.ok) {
          form.reset();
          setStatus({ tone: "success" });
        } else {
          setStatus({ tone: "error", text: "Inquiries are paused right now. Message us on Instagram instead." });
        }
      } catch {
        setStatus({ tone: "error", text: "That did not go through. Try once more." });
      }
    });
  }

  const sending = pending || status.tone === "sending";
  const statusText =
    status.tone === "success"
      ? "Received. We call every serious inquiry within two working days."
      : status.tone === "error"
        ? status.text
        : sending
          ? "Sending"
          : "";

  return (
    <section className="fb-section fb-franchise" id="franchise">
      <div className="fb-wrap fb-franchise__grid">
        <div data-reveal="">
          <p className="fb-eyebrow">Franchise</p>
          <h2 className="fb-display fb-franchise__title">Open a FRYBIRD in your city.</h2>
          <p className="fb-franchise__text">
            One recipe, one standard, a kitchen that runs on a 300 square foot footprint. We are taking partner
            inquiries across Punjab and Haryana first.
          </p>
        </div>
        <form className="fb-form" data-reveal="scale" noValidate onSubmit={onSubmit}>
          {FIELDS.map((field) => (
            <div className="fb-field" data-invalid={errors[field.name] ? "true" : "false"} key={field.name}>
              <label htmlFor={`fr-${field.name}`}>{field.label}</label>
              <input
                autoComplete={field.name === "phone" ? "tel" : field.name === "name" ? "name" : "off"}
                id={`fr-${field.name}`}
                name={field.name}
                placeholder={field.placeholder}
                type={field.type}
              />
              {errors[field.name] ? <span className="fb-field__error">{errors[field.name]}</span> : null}
            </div>
          ))}
          <div className="fb-field fb-field--wide" data-invalid={errors.message ? "true" : "false"}>
            <label htmlFor="fr-message">Message</label>
            <textarea id="fr-message" name="message" placeholder="Tell us about the location and your background" />
          </div>
          <div aria-hidden="true" className="fb-field" hidden>
            <label htmlFor="fr-company">Company</label>
            <input autoComplete="off" id="fr-company" name="company" tabIndex={-1} type="text" />
          </div>
          <div className="fb-form__foot">
            <p aria-live="polite" className="fb-form__status" data-tone={status.tone}>
              {statusText}
            </p>
            <button className="fb-target" disabled={sending} type="submit">
              Send inquiry
              <i aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
