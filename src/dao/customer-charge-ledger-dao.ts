import { injectable, inject } from 'inversify';
import type { Kysely } from 'kysely';
import type {
  CustomerChargeLedgerEntry,
  CustomerChargeUnit,
  Database,
} from '../db/types';
import { TYPES } from '../core/di-types';
import {
  buildCustomerChargeKey,
  inferCustomerChargeUnit,
} from '../backend/billing/customerChargeLedger';

export interface CustomerChargeLedgerMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

export interface CustomerChargeLedgerCreateData {
  usageEventId: string;
  providerUsageLedgerId?: string | null;
  userId: number;
  meterEventName: string;
  chargeUnit?: CustomerChargeUnit;
  quantity: number;
  polarBillable?: boolean;
  billingExternalId?: string;
  customerAmountMicroUsd?: number | null;
  metadata?: CustomerChargeLedgerMetadata | null;
  createdAt?: string;
}

@injectable()
export class CustomerChargeLedgerDAO {
  constructor(@inject(TYPES.Database) private db: Kysely<Database>) {}

  async create(data: CustomerChargeLedgerCreateData): Promise<string> {
    const id = crypto.randomUUID();

    await this.db
      .insertInto('customer_charge_ledger')
      .values({
        id,
        charge_key: buildCustomerChargeKey(data.usageEventId),
        usage_event_id: data.usageEventId,
        provider_usage_ledger_id: data.providerUsageLedgerId ?? null,
        user_id: data.userId,
        meter_event_name: data.meterEventName,
        charge_unit: data.chargeUnit ?? inferCustomerChargeUnit(data.meterEventName),
        quantity: data.quantity,
        polar_billable: data.polarBillable === false ? 0 : 1,
        billing_external_id: data.billingExternalId ?? data.usageEventId,
        customer_amount_micro_usd: data.customerAmountMicroUsd ?? null,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        created_at: data.createdAt ?? new Date().toISOString(),
      })
      .execute();

    return id;
  }

  async linkProviderUsage(usageEventId: string, providerUsageLedgerId: string): Promise<void> {
    await this.db
      .updateTable('customer_charge_ledger')
      .set({ provider_usage_ledger_id: providerUsageLedgerId })
      .where('usage_event_id', '=', usageEventId)
      .where('provider_usage_ledger_id', 'is', null)
      .execute();
  }

  async findByUsageEventId(usageEventId: string): Promise<CustomerChargeLedgerEntry | undefined> {
    return await this.db
      .selectFrom('customer_charge_ledger')
      .selectAll()
      .where('usage_event_id', '=', usageEventId)
      .executeTakeFirst();
  }

  async findByProviderUsageLedgerId(providerUsageLedgerId: string): Promise<CustomerChargeLedgerEntry[]> {
    return await this.db
      .selectFrom('customer_charge_ledger')
      .selectAll()
      .where('provider_usage_ledger_id', '=', providerUsageLedgerId)
      .orderBy('created_at', 'asc')
      .execute();
  }

  async findByUser(userId: number, limit = 100): Promise<CustomerChargeLedgerEntry[]> {
    return await this.db
      .selectFrom('customer_charge_ledger')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  }
}
