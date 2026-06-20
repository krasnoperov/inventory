import { injectable, inject } from 'inversify';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
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

export interface CustomerChargeReconciliation {
  usageEvents: number;
  chargeRows: number;
  missingChargeRows: number;
  orphanChargeRows: number;
  billableUsageQuantity: number;
  billableChargeQuantity: number;
  billableQuantityDelta: number;
  meters: Array<{
    name: string;
    usageQuantity: number;
    chargeQuantity: number;
    delta: number;
    matched: boolean;
  }>;
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

  async getReconciliationForPeriod(
    userId: number,
    startIso: string,
    endIso: string
  ): Promise<CustomerChargeReconciliation> {
    const usageTotals = await this.db
      .selectFrom('usage_events')
      .select('event_name')
      .select((eb) => eb.fn.sum<number>('quantity').as('quantity'))
      .where('user_id', '=', userId)
      .where('polar_billable', '=', 1)
      .where('created_at', '>=', startIso)
      .where('created_at', '<', endIso)
      .groupBy('event_name')
      .execute();

    const chargeTotals = await this.db
      .selectFrom('customer_charge_ledger')
      .select('meter_event_name')
      .select((eb) => eb.fn.sum<number>('quantity').as('quantity'))
      .where('user_id', '=', userId)
      .where('polar_billable', '=', 1)
      .where('created_at', '>=', startIso)
      .where('created_at', '<', endIso)
      .groupBy('meter_event_name')
      .execute();

    const counts = await this.db
      .selectFrom('usage_events as e')
      .leftJoin('customer_charge_ledger as c', 'c.usage_event_id', 'e.id')
      .select([
        sql<number>`count(e.id)`.as('usage_events'),
        sql<number>`count(c.id)`.as('charge_rows'),
        sql<number>`count(case when c.id is null then 1 end)`.as('missing_charge_rows'),
      ])
      .where('e.user_id', '=', userId)
      .where('e.created_at', '>=', startIso)
      .where('e.created_at', '<', endIso)
      .executeTakeFirst();

    const orphanCharges = await this.db
      .selectFrom('customer_charge_ledger as c')
      .leftJoin('usage_events as e', 'e.id', 'c.usage_event_id')
      .select(sql<number>`count(c.id)`.as('orphan_charge_rows'))
      .where('c.user_id', '=', userId)
      .where('c.created_at', '>=', startIso)
      .where('c.created_at', '<', endIso)
      .where('c.usage_event_id', 'is not', null)
      .where('e.id', 'is', null)
      .executeTakeFirst();

    const usageByMeter = new Map(usageTotals.map((row) => [row.event_name, Number(row.quantity) || 0]));
    const chargeByMeter = new Map(chargeTotals.map((row) => [row.meter_event_name, Number(row.quantity) || 0]));
    const meterNames = [...new Set([...usageByMeter.keys(), ...chargeByMeter.keys()])].sort();
    const meters = meterNames.map((name) => {
      const usageQuantity = usageByMeter.get(name) ?? 0;
      const chargeQuantity = chargeByMeter.get(name) ?? 0;
      const delta = usageQuantity - chargeQuantity;
      return {
        name,
        usageQuantity,
        chargeQuantity,
        delta,
        matched: delta === 0,
      };
    });
    const billableUsageQuantity = meters.reduce((sum, meter) => sum + meter.usageQuantity, 0);
    const billableChargeQuantity = meters.reduce((sum, meter) => sum + meter.chargeQuantity, 0);

    return {
      usageEvents: Number(counts?.usage_events) || 0,
      chargeRows: Number(counts?.charge_rows) || 0,
      missingChargeRows: Number(counts?.missing_charge_rows) || 0,
      orphanChargeRows: Number(orphanCharges?.orphan_charge_rows) || 0,
      billableUsageQuantity,
      billableChargeQuantity,
      billableQuantityDelta: billableUsageQuantity - billableChargeQuantity,
      meters,
    };
  }
}
