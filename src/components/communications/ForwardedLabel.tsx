import { Forward } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

/** Marks a forwarded message - in Inbox, Sent and the conversation, for both sides. */
export function ForwardedLabel({ className = "" }: { className?: string }) {
  return (
    <Badge tone="blue" className={`gap-1 ${className}`}>
      <Forward className="h-3 w-3" aria-hidden="true" />
      Forwarded
    </Badge>
  );
}
