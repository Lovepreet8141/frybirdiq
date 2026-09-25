/**
 * CodeBoxes auto-submit — real DOM timing, not just logic. Fail-first note:
 * live customer sign-in was broken (25 Sep 2026) because the auto-submit
 * called `form.requestSubmit()` synchronously inside the same event handler
 * that called `setDigits()` — `requestSubmit()` reads the hidden input's
 * value straight off the live DOM, and React hadn't committed the
 * just-typed digit to that node yet at that point in the handler, so every
 * auto-submit sent a value one digit short and failed the server's 6-digit
 * check before Supabase was ever asked. A pure-logic test (the main
 * `pnpm test` suite, node environment) cannot see this class of bug at all
 * — it only exists in real DOM commit timing. This is why this one test
 * file justifies its own jsdom suite (`pnpm test:dom`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CodeBoxes } from "./code-boxes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, useFormStatus: () => ({ pending: false }) };
});

let container: HTMLElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

function mount(invalid = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  let submittedToken: string | null | undefined;
  const onSubmit = vi.fn((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submittedToken = new FormData(e.currentTarget).get("token") as string | null;
  });

  act(() => {
    root!.render(
      <form onSubmit={onSubmit}>
        <CodeBoxes name="token" resetToken={0} invalid={invalid} />
      </form>,
    );
  });

  const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="text"]'));
  return { boxes, onSubmit, getSubmittedToken: () => submittedToken };
}

function typeDigit(box: HTMLInputElement, digit: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(box, digit);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CodeBoxes auto-submit — real DOM commit timing", () => {
  it("submits the FULL 6-digit value the instant the last box fills, not a stale 5-digit one", () => {
    const { boxes, onSubmit, getSubmittedToken } = mount();
    ["4", "2", "7", "1", "9", "5"].forEach((digit, i) => typeDigit(boxes[i]!, digit));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(getSubmittedToken()).toBe("427195");
  });

  it("does not submit at all before the 6th digit lands", () => {
    const { boxes, onSubmit } = mount();
    ["4", "2", "7", "1", "9"].forEach((digit, i) => typeDigit(boxes[i]!, digit));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits exactly once even if the last box's own value were set twice in a row", () => {
    const { boxes, onSubmit } = mount();
    ["4", "2", "7", "1", "9"].forEach((digit, i) => typeDigit(boxes[i]!, digit));
    typeDigit(boxes[5]!, "5");
    typeDigit(boxes[5]!, "5");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
