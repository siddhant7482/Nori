"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import {
  Camera,
  Check,
  FileWarning,
  ImageUp,
  Loader2,
  RotateCcw,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { categoryBySlug } from "@/lib/categories";
import { confidenceLevel } from "@/lib/orchestrator/reconcile";
import {
  PIPELINE_STAGES,
  readNdjson,
  type ResultMessage,
  type StageName,
} from "@/lib/pipeline/wire";

type Phase = "idle" | "running" | "done";

export function CapturePanel() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [current, setCurrent] = useState<StageName | null>(null);
  const [reached, setReached] = useState<Set<StageName>>(new Set());
  const [result, setResult] = useState<ResultMessage | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abort.current?.abort();
    setPhase("idle");
    setPreview((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
    setCurrent(null);
    setReached(new Set());
    setResult(null);
    setFatal(null);
  }, []);

  const analyze = useCallback(async (file: File) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setPhase("running");
    setResult(null);
    setFatal(null);
    setCurrent(null);
    setReached(new Set());
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });

    const body = new FormData();
    body.append("file", file);

    try {
      const res = await fetch("/api/receipts/analyze", {
        method: "POST",
        body,
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // Validation failures come back as problem+json before the stream starts.
        const problem = await res.json().catch(() => null);
        setFatal(
          problem?.detail ??
            (res.status === 401
              ? "Your session has expired. Sign in again."
              : `Upload failed (HTTP ${res.status}).`),
        );
        setPhase("done");
        return;
      }

      for await (const msg of readNdjson(res.body)) {
        if (msg.type === "stage") {
          setCurrent(msg.stage);
          setReached((s) => new Set(s).add(msg.stage));
        } else {
          setResult(msg);
        }
      }
      setPhase("done");
    } catch (e) {
      if (controller.signal.aborted) return;
      setFatal(e instanceof Error ? e.message : String(e));
      setPhase("done");
    }
  }, []);

  const onPick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void analyze(file);
  };

  if (phase === "idle") {
    return (
      <>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            onPick(e.dataTransfer.files);
          }}
          className={cn(
            "surface-edge relative overflow-hidden rounded-2xl border border-dashed transition-colors",
            dragging
              ? "border-primary bg-primary/5"
              : "border-border bg-card hover:border-muted-foreground/40",
          )}
        >
          <div className="bg-grid absolute inset-0" aria-hidden />
          <div className="relative flex flex-col items-center px-6 py-16 text-center">
            <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <ImageUp className="size-6" aria-hidden />
            </div>

            <h2 className="text-lg font-medium">Add a receipt</h2>
            <p className="mt-1.5 max-w-sm text-sm text-pretty text-muted-foreground">
              Photograph it flat, in good light, square-on. Nori reads the text,
              pulls out the figures, and checks they add up.
            </p>

            <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
              {/* `capture` opens the rear camera directly on mobile rather than
                  a file browser — the difference between two taps and five. */}
              <Button
                className="glow-primary gap-2 sm:hidden"
                onClick={() => cameraInput.current?.click()}
              >
                <Camera className="size-4" aria-hidden />
                Take a photo
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => fileInput.current?.click()}
              >
                <Upload className="size-4" aria-hidden />
                Choose an image
              </Button>
            </div>

            <p className="mt-5 text-xs text-muted-foreground">
              JPEG, PNG, WebP or HEIC · up to 10 MB
            </p>
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => onPick(e.target.files)}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => onPick(e.target.files)}
        />
      </>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
      <ReceiptPane preview={preview} onReset={reset} />

      <div className="space-y-4">
        <StageList current={current} reached={reached} result={result} />
        {fatal && <FatalError message={fatal} onReset={reset} />}
        {result && !result.ok && <PipelineError result={result} onReset={reset} />}
        {result?.ok && result.receipt && <Extracted result={result} />}
        {result && <OcrDebug result={result} />}
      </div>
    </div>
  );
}

function ReceiptPane({
  preview,
  onReset,
}: {
  preview: string | null;
  onReset: () => void;
}) {
  return (
    <div className="surface-edge relative overflow-hidden rounded-xl border bg-card lg:sticky lg:top-6 lg:self-start">
      <div className="bg-grid absolute inset-0" aria-hidden />
      <div className="relative flex min-h-64 items-center justify-center p-5">
        {preview && (
          // Blob URL of a local file — Next's optimiser cannot process it, and
          // there is no benefit in doing so for an image already on the device.
          <Image
            src={preview}
            alt="The receipt being analysed"
            width={520}
            height={800}
            unoptimized
            className="max-h-[32rem] w-auto rounded-lg object-contain shadow-2xl shadow-black/50"
          />
        )}
      </div>
      <div className="relative border-t p-3">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onReset}>
          <RotateCcw className="size-3.5" aria-hidden />
          Use a different image
        </Button>
      </div>
    </div>
  );
}

function StageList({
  current,
  reached,
  result,
}: {
  current: StageName | null;
  reached: Set<StageName>;
  result: ResultMessage | null;
}) {
  const finished = result !== null;
  const failed = current === "failed" || (finished && !result?.ok);

  return (
    <div className="surface-edge rounded-xl border bg-card p-5">
      <ol className="space-y-2.5" aria-live="polite">
        {PIPELINE_STAGES.map(({ stage, label }) => {
          const done = finished ? !failed || reached.has(stage) : reached.has(stage) && current !== stage;
          const active = current === stage && !finished;
          const idle = !reached.has(stage);

          return (
            <li key={stage} className="flex items-center gap-2.5 text-sm">
              <span className="flex size-4 shrink-0 items-center justify-center">
                {active ? (
                  <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
                ) : done ? (
                  <Check className="size-3.5 text-primary" aria-hidden />
                ) : (
                  <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                )}
              </span>
              <span className={cn(idle && "text-muted-foreground", active && "text-foreground")}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {result?.timings?.total !== undefined && (
        <div className="mt-4 space-y-1.5 border-t pt-3 text-xs text-muted-foreground">
          <p>
            Finished in {(result.timings.total / 1000).toFixed(1)}s
            {result.usage &&
              ` · ${result.usage.model} · ${result.usage.inputTokens}→${result.usage.outputTokens} tokens`}
          </p>
          {result.path && (
            // Which route ran is the first thing you need when a result looks
            // wrong — it decides whether to reach for the prompt or the OCR.
            <p className="flex items-center gap-1.5">
              <Badge
                variant="secondary"
                className={cn(
                  "px-1.5 py-0 font-normal",
                  result.path === "vision"
                    ? "bg-primary/12 text-primary"
                    : "bg-muted",
                )}
              >
                {result.path === "vision" ? "read from image" : "read from OCR"}
              </Badge>
              <span>{result.pathReason}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FatalError({ message, onReset }: { message: string; onReset: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/8 p-5">
      <p className="flex items-center gap-2 font-medium">
        <FileWarning className="size-4 text-destructive" aria-hidden />
        Upload failed
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">{message}</p>
      <Button size="sm" variant="outline" className="mt-4" onClick={onReset}>
        Try again
      </Button>
    </div>
  );
}

function PipelineError({
  result,
  onReset,
}: {
  result: ResultMessage;
  onReset: () => void;
}) {
  const isQuality = result.errorCode === "LOW_OCR_QUALITY";
  const isDisabled = result.errorCode === "LLM_DISABLED";

  return (
    <div
      className={cn(
        "rounded-xl border p-5",
        isDisabled
          ? "border-warning/30 bg-warning/8"
          : "border-destructive/30 bg-destructive/8",
      )}
    >
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert
          className={cn("size-4", isDisabled ? "text-warning" : "text-destructive")}
          aria-hidden
        />
        {isQuality
          ? "That image could not be read"
          : isDisabled
            ? "Extraction is switched off"
            : "Something went wrong"}
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">{result.errorMessage}</p>

      {isDisabled && (
        <p className="mt-3 rounded-md bg-background/50 p-3 font-mono text-xs text-muted-foreground">
          Set OPENROUTER_API_KEY in .env, then restart the dev server.
        </p>
      )}

      {/* The image is never discarded on failure — the user keeps whatever the
          OCR did manage to read, and can retry without re-photographing. */}
      {result.ocr?.text?.trim() && (
        <p className="mt-3 text-xs text-muted-foreground">
          The text Nori did read is shown below.
        </p>
      )}

      <Button size="sm" variant="outline" className="mt-4" onClick={onReset}>
        Try another image
      </Button>
    </div>
  );
}

function Extracted({ result }: { result: ResultMessage }) {
  const r = result.receipt!;
  const currency = r.currency ?? "GBP";
  const cat = categoryBySlug(r.category);
  const c = r.fieldConfidence;

  const warnFor = (field: string) =>
    result.warnings.filter((w) => w.field === field);

  return (
    <div className="surface-edge rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b p-5 py-4">
        <h2 className="font-medium">Extracted</h2>
        {result.needsReview && (
          <Badge variant="secondary" className="gap-1 bg-warning/15 text-warning">
            <TriangleAlert className="size-3" aria-hidden />
            Needs review
          </Badge>
        )}
      </div>

      <div className="space-y-3.5 p-5">
        <Field
          label="Merchant"
          value={r.merchantName}
          confidence={c.merchantName}
          warnings={warnFor("merchantName")}
        />
        <Field
          label="Date"
          value={r.purchasedAt ? formatDate(r.purchasedAt) : null}
          confidence={c.purchasedAt}
          warnings={warnFor("purchasedAt")}
        />
        <Field
          label="Category"
          value={cat ? `${cat.icon}  ${cat.name}` : null}
          hint={r.categoryReason ?? undefined}
          warnings={warnFor("category")}
        />

        {r.lineItems.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Line items ({r.lineItems.length})
            </p>
            <ul className="divide-y rounded-md border">
              {r.lineItems.map((li, i) => (
                <li
                  key={`${li.description}-${i}`}
                  className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="truncate">
                    {li.description}
                    {li.quantity !== 1 && (
                      <span className="text-muted-foreground"> ×{li.quantity}</span>
                    )}
                  </span>
                  <span className="numeric shrink-0">
                    {formatMoney(li.total, currency)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1.5 rounded-md border p-3 text-sm">
          <Total label="Subtotal" value={r.subtotal} currency={currency} />
          <Total label="Tax" value={r.taxTotal} currency={currency} />
          {r.tipTotal !== null && r.tipTotal !== 0 && (
            <Total label="Tip / service" value={r.tipTotal} currency={currency} />
          )}
          <div className="border-t pt-1.5">
            <Total label="Total" value={r.total} currency={currency} strong />
          </div>
        </div>

        {result.warnings.length > 0 && (
          <ul className="space-y-1.5">
            {result.warnings.map((w, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-1.5 text-xs",
                  w.severity === "error" ? "text-destructive" : "text-warning",
                )}
              >
                <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                {w.message}
              </li>
            ))}
          </ul>
        )}

        {r.paymentMethod && (
          <p className="text-xs text-muted-foreground">
            Paid by {r.paymentMethod.toLowerCase()}
            {r.cardLast4 && ` ending ${r.cardLast4}`}
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  confidence,
  hint,
  warnings = [],
}: {
  label: string;
  value: string | null;
  confidence?: number;
  hint?: string;
  warnings?: Array<{ message: string }>;
}) {
  const level = confidence === undefined ? "high" : confidenceLevel(confidence);
  const missing = !value;

  return (
    <div>
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {(level === "low" || missing) && (
          <TriangleAlert className="size-3 text-warning" aria-hidden />
        )}
        {confidence !== undefined && (
          // Confidence is never conveyed by colour alone (spec §8.2): the
          // percentage is announced to screen readers and the field carries a
          // distinct border and underline treatment per level.
          <span className="sr-only">
            {Math.round(confidence * 100)}% confidence
          </span>
        )}
      </span>

      <div
        className={cn(
          "rounded-md border bg-background/60 px-3 py-2 text-sm",
          level === "high" && "field-confidence-high",
          level === "medium" && "field-confidence-medium",
          level === "low" && "field-confidence-low",
          missing && "text-muted-foreground italic",
        )}
      >
        {value ?? "Not found"}
      </div>

      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {warnings.map((w, i) => (
        <p key={i} className="mt-1 text-xs text-warning">
          {w.message}
        </p>
      ))}
    </div>
  );
}

function Total({
  label,
  value,
  currency,
  strong,
}: {
  label: string;
  value: number | null;
  currency: string;
  strong?: boolean;
}) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "font-semibold")}>
      <span className={cn(!strong && "text-muted-foreground")}>{label}</span>
      <span className="numeric">
        {value === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatMoney(value, currency)
        )}
      </span>
    </div>
  );
}

function OcrDebug({ result }: { result: ResultMessage }) {
  const [open, setOpen] = useState(false);
  if (!result.ocr?.text?.trim()) return null;

  return (
    <div className="surface-edge rounded-xl border bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="font-medium">Raw OCR text</span>
        <span className="text-xs text-muted-foreground">
          {result.ocr.confidence.toFixed(0)}/100 · {result.ocr.wordCount} words ·{" "}
          {result.ocr.width}×{result.ocr.height}
        </span>
      </button>

      {open && (
        <pre className="scrollbar-subtle max-h-80 overflow-auto border-t bg-background/40 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {result.ocr.text}
        </pre>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
