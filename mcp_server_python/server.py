from fastmcp import FastMCP
from typing import List, Dict, Optional
import datetime
import json

# --- TALLIGENCE ORCHESTRATOR: SENIOR INTEGRATION LAYER --- #
# Goal: Transform static app data into an agentic business system.

mcp = FastMCP("Talligence Orchestrator", version="2.0.0")

# --- MEMORY LAYER (SYSTEM STATE LOG) --- #
# Tracks agent decisions to ensure continuity across orchestrations.
class SystemState:
    def __init__(self):
        self.decision_log: List[Dict] = []
        self.session_start = datetime.datetime.now().isoformat()

    def log_decision(self, action: str, reason: str, metadata: Dict = None):
        entry = {
            "timestamp": datetime.datetime.now().isoformat(),
            "action": action,
            "reason": reason,
            "metadata": metadata or {}
        }
        self.decision_log.append(entry)

    def get_audit_trail(self) -> str:
        return json.dumps(self.decision_log, indent=2)

state = SystemState()

# --- MOCK DATABASE LAYER (EASY-SWAP) --- #
# Structured to be replaced by real SQLAlchemy or Supabase calls.

mock_db = {
    "invoices": [
        {"id": "INV-001", "amount": 50000, "status": "pending", "priority": "medium", "gst_match": False},
        {"id": "INV-002", "amount": 120000, "status": "approved", "priority": "high", "gst_match": True},
        {"id": "INV-003", "amount": 35000, "status": "pending", "priority": "medium", "gst_match": False},
    ],
    "bank_balance": 150000.0,
    "gst_liabilities": 85000.0,
    "compliance_alerts": [
        {"type": "GST_MISMATCH", "invoice_id": "INV-001", "severity": "CRITICAL", "details": "Invoice amount differs from bank record."},
        {"type": "LIQUIDITY_RISK", "severity": "HIGH", "details": "Upcoming tax liability exceeds 50% of available cash."}
    ]
}

def db_get_invoices(): return mock_db["invoices"]
def db_get_bank_balance(): return mock_db["bank_balance"]
def db_get_gst_liabilities(): return mock_db["gst_liabilities"]
def db_get_compliance_alerts(): return mock_db["compliance_alerts"]
def db_update_invoice(id, updates):
    for inv in mock_db["invoices"]:
        if inv["id"] == id:
            inv.update(updates)
            return True
    return False

# --- CONTEXTUAL RESOURCES --- #

@mcp.resource("business://ledger/summary")
def get_ledger_summary() -> str:
    """
    Returns a unified executive view of the business financial standing.
    Critical for identifying when liquidity is at risk before committing to payments.
    """
    balance = db_get_bank_balance()
    liabilities = db_get_gst_liabilities()
    ratio = (liabilities / balance) if balance > 0 else 1.0
    
    summary = {
        "cash_on_hand": balance,
        "upcoming_tax_liabilities": liabilities,
        "liquidity_ratio": round(ratio, 2),
        "status": "CAUTION" if ratio > 0.5 else "STABLE",
        "timestamp": datetime.datetime.now().isoformat()
    }
    return f"LEDGER SUMMARY:\n{json.dumps(summary, indent=2)}"

@mcp.resource("business://compliance/alerts")
def get_compliance_alerts() -> str:
    """
    Retrieves active GST and regulatory mismatches.
    This resource is the primary trigger for the audit_and_reconcile workflow.
    """
    alerts = db_get_compliance_alerts()
    return f"COMPLIANCE ALERTS:\n{json.dumps(alerts, indent=2)}"

@mcp.resource("system://agent/memory")
def get_agent_memory() -> str:
    """
    Provides the historical context of decisions made by the agent in this session.
    Failsafe for auditability.
    """
    return f"AGENT DECISION LOG:\n{state.get_audit_trail()}"

# --- ACTIONABLE TOOLS (THE INTELLIGENCE LAYER) --- #

@mcp.tool()
def reconcile_invoice(invoice_id: str) -> str:
    """
    BUSINESS IMPACT: Critical for GST compliance. Use this tool to fix data mismatches
    between invoices and bank records. Calling this prevents regulatory fines and
    ensures accurate Input Tax Credit (ITC) reporting.
    """
    success = db_update_invoice(invoice_id, {"gst_match": True})
    if success:
        state.log_decision(
            action="reconcile_invoice",
            reason="Fixing GST mismatch for compliance optimization.",
            metadata={"invoice_id": invoice_id}
        )
        return f"Successfully reconciled {invoice_id}. GST status updated to MATCHED."
    return f"Error: Invoice {invoice_id} not found."

@mcp.tool()
def adjust_payment_priority(invoice_id: str, priority_level: str) -> str:
    """
    BUSINESS IMPACT: Strategic Liquidity Management. Use this to 'defer' payments for
    low-priority invoices when cash flow is tight, or 'accelerate' high-priority
    payments to maintain vendor trust when bank balance is healthy.
    Protect the business's ability to cover tax liabilities by delaying lower-ranked costs.
    """
    valid_levels = ["low", "medium", "high", "deferred"]
    if priority_level not in valid_levels:
        return f"Invalid priority level. Must be one of: {valid_levels}"

    success = db_update_invoice(invoice_id, {"priority": priority_level})
    if success:
        state.log_decision(
            action="adjust_payment_priority",
            reason=f"Adjusted priority to {priority_level} to protect business liquidity.",
            metadata={"invoice_id": invoice_id, "new_priority": priority_level}
        )
        return f"Payment priority for {invoice_id} set to {priority_level}."
    return f"Error: Invoice {invoice_id} not found."

# --- CUSTOM PROMPTS (THE BRAIN) --- #

@mcp.prompt("audit_and_reconcile")
def audit_and_reconcile_prompt() -> str:
    """
    The Master Orchestration Prompt for business health.
    Instructs the agent to scan for risks and take defensive fiscal action.
    """
    return """You are the Senior Business Auditor for Talligence. 
Follow this multi-step operational logic to protect company interests:

1. READ business://compliance/alerts to identify any GST mismatches or liquidity warnings.
2. READ business://ledger/summary to assess the current Cash-vs-Tax capability.
3. ANALYSIS: If you see a GST mismatch (type: GST_MISMATCH), use reconcile_invoice IMMEDIATELY to avoid penalties.
4. PROTECTION: If the liquidity ratio is > 0.5 (CAUTION) and you find associated invoices for the alerts, 
   use adjust_payment_priority with 'deferred' to protect cash for the upcoming tax liabilities.
5. REPORT: Provide a summary of your actions and how they improved the business safety profile.

Verify the system state via system://agent/memory if you are continuing a previous workflow thread."""

if __name__ == "__main__":
    mcp.run()
