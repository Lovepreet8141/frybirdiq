import { LoadingState } from "@/components/states";

export default function Loading() {
  return (
    <div className="p-3">
      <LoadingState rows={4} />
    </div>
  );
}
