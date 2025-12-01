import { Badge } from "./ui/badge";

type Status =
  | "draft"
  | "sent"
  | "approved"
  | "rejected"
  | "pending"
  | "processing"
  | "awaiting_approval"
  | "materials_received"
  | "completed";

const statusConfig: Record<
  Status,
  { label: string; className: string }
> = {
  draft: { label: "Draft", className: "status-draft" },
  sent: { label: "Sent", className: "status-sent" },
  approved: { label: "Approved", className: "status-approved" },
  rejected: { label: "Rejected", className: "status-rejected" },
  pending: { label: "Pending", className: "status-pending" },
  processing: { label: "Processing", className: "status-processing" },
  awaiting_approval: { label: "Awaiting Approval", className: "status-awaiting-approval" },
  materials_received: { label: "Materials Received", className: "status-approved" },
  completed: { label: "Completed", className: "status-approved" },
};

export function StatusBadge({ status }: { status: Status }) {
  const config = statusConfig[status] || statusConfig.draft;
  return (
    <Badge className={`status-chip ${config.className}`}>
      {config.label}
    </Badge>
  );
}
