export type MemberStatus = "pending" | "active" | "left" | "removed" | "denied";
export type SettlementStatus = "pending" | "confirmed" | "rejected";

/** Member as exposed to clients. Device ids never leave the server. */
export interface MemberPub {
  id: string;
  name: string;
  isHost: boolean;
  status: MemberStatus;
  joinedAt: string;
}

export interface ExpensePub {
  id: string;
  label: string;
  amountCents: number;
  paidBy: string;
  createdBy: string;
  createdAt: string;
}

export interface SettlementPub {
  id: string;
  from: string;
  to: string;
  amountCents: number;
  status: SettlementStatus;
  createdAt: string;
  resolvedAt: string | null;
}

/** Per-member ledger line. netCents > 0 means the group owes them. */
export interface Balance {
  memberId: string;
  paidCents: number;
  shareCents: number;
  sentCents: number;
  recvCents: number;
  netCents: number;
}

/** One suggested repayment in the minimal-transfer plan. */
export interface Transfer {
  from: string;
  to: string;
  amountCents: number;
}

export interface EventState {
  restricted: false;
  event: { id: string; name: string; code: string; currency: string };
  me: { memberId: string; name: string; isHost: boolean; status: MemberStatus };
  members: MemberPub[];
  expenses: ExpensePub[];
  settlements: SettlementPub[];
  balances: Balance[];
  transfers: Transfer[];
  totalSpentCents: number;
  /** Pending settlements waiting on MY confirmation. */
  pendingForMe: number;
}

/** What a non-active member (waiting room / removed / left / denied) can see. */
export interface RestrictedState {
  restricted: true;
  event: { id: string; name: string };
  me: { memberId: string; name: string; isHost: boolean; status: MemberStatus };
  hostName: string;
}

export type StateResponse = EventState | RestrictedState;

export interface MyEventSummary {
  eventId: string;
  eventName: string;
  myName: string;
  myStatus: MemberStatus;
  isHost: boolean;
  activeCount: number;
  totalSpentCents: number;
  pendingForMe: number;
}
