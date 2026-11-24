import { randomUUID } from 'node:crypto';
import type * as vscode from 'vscode';

import { type DayActivity, localDay, merge, metrics } from './activity';
import { type Api, ApiError } from './api';
import type { Tag } from './copy';

export interface QueuedCheckIn {
	clientId: string;
	score: number;
	tag?: Tag;
	source: 'ide';
	capturedAt: string;
}

interface SyncPart {
	accepted: number;
	duplicates: number;
	rejected: { index: number; reason: string }[];
}
export interface SyncState {
	consent: { dataSource: string; granted: boolean }[];
	preferences: { focusMode: boolean };
}

const QUEUE = 'selyh.queue';
const ACT = 'selyh.act:'; // selyh.act:<día>:<ventana>
const KEEP_DAYS = 7;

/**
 * Estado local en `globalState`: compartido por todas las ventanas de VS Code y persistente.
 * Cada ventana guarda su propia actividad del día (no se pisan) y al enviar se suman.
 */
export class Store {
	/** Último estado conocido del servidor (permisos, preferencias). */
	state?: SyncState;

	constructor(
		private readonly g: vscode.Memento,
		private readonly api: Api,
		private readonly windowId: string,
	) {}

	get<T>(key: string, fallback: T): T {
		return this.g.get<T>(`selyh.${key}`, fallback);
	}
	set(key: string, value: unknown) {
		return this.g.update(`selyh.${key}`, value);
	}

	granted(source: string) {
		return this.state?.consent.some((c) => c.dataSource === source && c.granted) ?? false;
	}

	pending() {
		return this.g.get<QueuedCheckIn[]>(QUEUE, []).length;
	}

	async enqueue(score: number, tag?: Tag) {
		const item: QueuedCheckIn = { clientId: randomUUID(), score, source: 'ide', capturedAt: new Date().toISOString(), ...(tag ? { tag } : {}) };
		await this.g.update(QUEUE, [...this.g.get<QueuedCheckIn[]>(QUEUE, []), item]);
		return item;
	}

	saveActivity(day: string, a: DayActivity) {
		return this.g.update(`${ACT}${day}:${this.windowId}`, a);
	}

	/** Actividad de un día sumando todas las ventanas. */
	activityOf(day: string): DayActivity {
		const parts = this.g
			.keys()
			.filter((k) => k.startsWith(`${ACT}${day}:`))
			.map((k) => this.g.get<DayActivity>(k)!)
			.filter(Boolean);
		return merge(parts);
	}

	private activityDays() {
		return [...new Set(this.g.keys().filter((k) => k.startsWith(ACT)).map((k) => k.slice(ACT.length, ACT.length + 10)))];
	}

	/**
	 * Envía la cola y las señales de los últimos días. Idempotente: los check-ins llevan `clientId`
	 * y las señales se guardan por día, así que reenviar no duplica. Devuelve si hubo red.
	 */
	async sync(deviceId?: string): Promise<{ ok: boolean; waitingConsent: number }> {
		const queue = this.g.get<QueuedCheckIn[]>(QUEUE, []);
		const today = localDay();
		const days = this.activityDays().sort();
		const signals = this.granted('IDE_GIT')
			? days.map((date) => ({ date, sourceType: 'IDE', metrics: metrics(this.activityOf(date)) })).filter((s) => s.metrics.hoursActive > 0)
			: [];
		let res: { checkIns: SyncPart; signals: SyncPart; state: SyncState };
		try {
			res = await this.api.call('POST', '/sync', { ...(deviceId ? { deviceId } : {}), checkIns: queue, signals });
		} catch (e) {
			if (e instanceof ApiError && e.isNetwork) {
				return { ok: false, waitingConsent: 0 };
			}
			throw e;
		}
		this.state = res.state;
		// Se quedan solo los que esperan permiso; los aceptados, duplicados o inválidos salen de la cola.
		const waiting = new Set(res.checkIns.rejected.filter((r) => r.reason === 'CONSENT_REQUIRED').map((r) => queue[r.index]?.clientId));
		const sent = new Set(queue.map((q) => q.clientId));
		const latest = this.g.get<QueuedCheckIn[]>(QUEUE, []); // pudo crecer mientras se enviaba
		await this.g.update(QUEUE, latest.filter((q) => !sent.has(q.clientId) || waiting.has(q.clientId)));
		// Días cerrados y enviados (o muy viejos) se borran; hoy sigue acumulando.
		const cutoff = localDay(new Date(Date.now() - KEEP_DAYS * 86_400_000));
		for (const k of this.g.keys().filter((k) => k.startsWith(ACT))) {
			const day = k.slice(ACT.length, ACT.length + 10);
			if (day < cutoff || (day < today && signals.length > 0 && res.signals.rejected.length === 0)) {
				await this.g.update(k, undefined);
			}
		}
		return { ok: true, waitingConsent: waiting.size };
	}
}
