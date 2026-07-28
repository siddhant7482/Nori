import { CapturePanel } from "@/components/receipts/capture-panel";

export const metadata = { title: "Add a receipt" };

export default function CapturePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add a receipt</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nori reads the paper, extracts the figures, and checks the arithmetic
          before anything reaches your ledger.
        </p>
      </div>

      <CapturePanel />
    </div>
  );
}
