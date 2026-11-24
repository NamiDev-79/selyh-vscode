import * as vscode from 'vscode';

import { localDay } from './activity';
import { type Api, ApiError, errorText } from './api';
import { webUrl } from './config';
import { scale, scaleNames, sleepHours, sleepQuality, t, tags, type Tag } from './copy';
import type { Store } from './store';

export interface Ctx {
	api: Api;
	store: Store;
	/** Repinta la barra de estado. */
	refresh(): void;
	/** Abre una pausa guiada (pause.ts). */
	openPause(): Promise<void>;
}

interface CrisisResource {
	name: string;
	contactInfo: string;
}

const pick = <T extends vscode.QuickPickItem>(items: T[], o: vscode.QuickPickOptions) => vscode.window.showQuickPick(items, { ignoreFocusOut: true, ...o });

// ───── Vincular (flujo de dispositivo: código que se aprueba en la web) ─────

export async function link(ctx: Ctx) {
	const start = await ctx.api.anon<{ deviceCode: string; userCode: string; verificationUriComplete: string; expiresIn: number; interval: number }>(
		'POST',
		'/auth/device/start',
		{ platform: 'vscode', deviceName: 'VS Code' },
	);
	// La web es la que muestra el código: se abre la URL de Selyh configurada, no la que llegue de la red.
	await vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}/device?code=${encodeURIComponent(start.userCode)}`));
	void vscode.window.showInformationMessage(t.linkCode(start.userCode));

	const result = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: t.linkWaiting(start.userCode), cancellable: true },
		async (_p, cancel) => {
			const until = Date.now() + start.expiresIn * 1000;
			let wait = Math.max(2, start.interval) * 1000;
			while (!cancel.isCancellationRequested && Date.now() < until) {
				await new Promise((r) => setTimeout(r, wait));
				try {
					return await ctx.api.anon<{ accessToken: string; refreshToken: string; deviceId: string; user: { name?: string } }>('POST', '/auth/device/token', {
						deviceCode: start.deviceCode,
					});
				} catch (e) {
					if (!(e instanceof ApiError)) {
						throw e;
					}
					if (e.code === 'authorization_pending' || e.isNetwork) {
						continue;
					}
					if (e.code === 'slow_down') {
						wait += 2000;
						continue;
					}
					throw new Error(e.code === 'access_denied' ? t.linkDenied : t.linkExpired);
				}
			}
			return undefined;
		},
	);
	if (!result) {
		return;
	}
	await ctx.api.saveSession(result);
	await ctx.store.set('deviceId', result.deviceId);
	await ctx.store.set('userName', result.user.name ?? null);
	await chooseConsent(ctx);
	void vscode.window.showInformationMessage(t.linkDone(result.user.name));
	ctx.refresh();
}

/** Permisos que tienen sentido en el editor. Check-ins viene marcado; las señales, no. */
export async function chooseConsent(ctx: Ctx) {
	const state = await ctx.api.call<{ dataSource: string; granted: boolean }[]>('GET', '/consent');
	const has = (s: string) => state.some((c) => c.dataSource === s && c.granted);
	const items = [
		{ label: 'Check-ins', detail: t.consentCheckin, source: 'CHECKIN', picked: true },
		{ label: 'Señales del editor', detail: t.consentSignals, source: 'IDE_GIT', picked: has('IDE_GIT') },
		{ label: 'Sueño', detail: t.consentSleep, source: 'SLEEP', picked: has('SLEEP') },
	];
	const chosen = await vscode.window.showQuickPick(items, { canPickMany: true, ignoreFocusOut: true, title: 'Selyh · Permisos', placeHolder: t.consentTitle });
	if (!chosen) {
		return;
	}
	for (const it of items) {
		const want = chosen.includes(it);
		if (want !== has(it.source)) {
			await ctx.api.call('PUT', `/consent/${it.source}`, { granted: want });
		}
	}
	await sync(ctx);
}

export async function unlink(ctx: Ctx) {
	try {
		await sync(ctx); // lo pendiente se envía antes de cerrar
	} catch {
		/* se cierra igual */
	}
	await ctx.api.logout();
	await ctx.store.set('deviceId', null);
	await ctx.store.set('userName', null);
	ctx.refresh();
	void vscode.window.showInformationMessage(t.signedOut);
}

export async function sync(ctx: Ctx) {
	const r = await ctx.store.sync(ctx.store.get<string | undefined>('deviceId', undefined));
	ctx.refresh();
	return r;
}

// ───── Check-in ─────

export async function checkIn(ctx: Ctx, score?: number) {
	if (score === undefined) {
		const s = await pick(
			scale.map((s) => ({ label: `${s.bar}  ${s.value} · ${s.label}`, value: s.value })),
			{ title: 'Selyh · Check-in', placeHolder: t.question },
		);
		if (!s) {
			return snooze(ctx);
		}
		score = s.value;
	}
	const tg = await pick([{ label: t.noTag, value: undefined as Tag | undefined }, ...tags.map((x) => ({ label: x.label, value: x.value as Tag | undefined }))], {
		title: 'Selyh · Check-in',
		placeHolder: t.tagPrompt,
	});
	const firstToday = ctx.store.get('lastCheckInDay', '') !== localDay();
	await ctx.store.enqueue(score, tg?.value);
	await ctx.store.set('lastCheckInDay', localDay());
	await snooze(ctx);
	let r = { ok: false, waitingConsent: 0 };
	try {
		r = await sync(ctx);
	} catch (e) {
		void vscode.window.showWarningMessage(errorText(e));
	}
	if (r.waitingConsent) {
		void vscode.window.showInformationMessage(t.needsConsent);
	} else if (!r.ok) {
		void vscode.window.showInformationMessage(t.queued);
	} else if (score >= 4) {
		// Con carga alta se OFRECE una pausa; nunca se abre sola.
		void vscode.window.showInformationMessage(t.heavy, t.offerPause).then((a) => {
			if (a) {
				void ctx.openPause();
			}
		});
	} else {
		vscode.window.setStatusBarMessage(`$(check) ${t.thanks}`, 4000);
	}
	if (r.ok && firstToday) {
		await askSleep(ctx);
	}
}

/** Tras el primer check-in del día, si hay permiso SLEEP y no se registró hoy en otro dispositivo. */
async function askSleep(ctx: Ctx) {
	if (!ctx.store.granted('SLEEP')) {
		return;
	}
	const today = localDay();
	const rows = await ctx.api.call<{ sourceType: string; date: string }[]>('GET', '/signals?days=2').catch(() => []);
	if (rows.some((r) => r.sourceType === 'SLEEP' && r.date === today)) {
		return;
	}
	const q = await pick(sleepQuality.map((s) => ({ label: s.label, value: s.value })), { title: 'Selyh · Sueño', placeHolder: t.sleepQuestion });
	if (!q) {
		return;
	}
	const h = await pick(sleepHours.map((s) => ({ label: s.label, value: s.value })), { title: 'Selyh · Sueño', placeHolder: t.sleepHours });
	try {
		await ctx.api.call('POST', '/signals', { date: today, sourceType: 'SLEEP', metrics: { quality: q.value, ...(h ? { hours: h.value } : {}) } });
		vscode.window.setStatusBarMessage(`$(check) ${t.sleepSaved}`, 5000);
	} catch (e) {
		void vscode.window.showWarningMessage(errorText(e));
	}
}

/** No volver a ofrecer el check-in por un rato (respondido o descartado). */
export function snooze(ctx: Ctx, minutes = 120) {
	return ctx.store.set('cooldownUntil', Date.now() + minutes * 60_000);
}

export async function pauseReminders(ctx: Ctx) {
	const end = new Date();
	end.setHours(23, 59, 0, 0);
	const opts = [
		{ label: 'Durante 1 hora', until: Date.now() + 3_600_000 },
		{ label: 'Durante 3 horas', until: Date.now() + 3 * 3_600_000 },
		{ label: 'Hasta mañana', until: end.getTime() },
		{ label: 'Reanudar ahora', until: 0 },
	];
	const p = await pick(opts, { title: 'Selyh · Pausar avisos' });
	if (!p) {
		return;
	}
	await ctx.store.set('pausedUntil', p.until);
	ctx.refresh();
	if (p.until) {
		vscode.window.setStatusBarMessage(t.paused(new Date(p.until).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })), 4000);
	}
}

// ───── Mi estado y preferencias ─────

interface Analytics {
	calibration: { daysWithData: number; required: number; calibrated: boolean };
	latest: { trendLabel: string; message: string } | null;
	series: { date: string; trendLabel: string }[];
	disclaimer: string;
}

/** Tu carga frente a tu propio ritmo, igual que en el panel. */
export async function status(ctx: Ctx) {
	const a = await ctx.api.call<Analytics>('GET', '/analytics/me');
	const head = !a.calibration.calibrated
		? 'Selyh está conociendo tu ritmo'
		: a.latest
			? `Tu carga hoy: ${t.trend[a.latest.trendLabel] ?? a.latest.trendLabel}`
			: 'Aún no hay datos de hoy';
	const body = !a.calibration.calibrated ? t.calibrating(a.calibration.daysWithData, a.calibration.required) : (a.latest?.message ?? 'Responde un check-in para ver cómo vas.');
	const week = a.series.slice(-7).map((d) => `${d.date.slice(5)} · ${t.trend[d.trendLabel] ?? d.trendLabel}`);
	const open = 'Abrir mi panel';
	const detail = [body, week.length ? `Últimos días:\n${week.join('\n')}` : '', a.disclaimer].filter(Boolean).join('\n\n');
	const r = await vscode.window.showInformationMessage(head, { modal: true, detail }, open);
	if (r === open) {
		await vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}/panel`));
	}
}

interface Preferences {
	focusMode: boolean;
	quietHoursStart: string | null;
	quietHoursEnd: string | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Modo foco (solo pausas naturales) y horas de silencio. Se guardan en tu cuenta: valen en todos tus dispositivos. */
export async function preferences(ctx: Ctx) {
	const p = await ctx.api.call<Preferences>('GET', '/preferences');
	const quiet = p.quietHoursStart && p.quietHoursEnd ? `${p.quietHoursStart} a ${p.quietHoursEnd}` : 'Apagadas';
	const items = [
		{ label: `$(${p.focusMode ? 'check' : 'circle-large-outline'}) Modo foco`, detail: 'Solo aparece en pausas naturales, nunca de forma periódica.', key: 'focus' },
		{ label: '$(bell-slash) Horas de silencio', description: quiet, detail: 'En ese horario Selyh no pregunta nada.', key: 'quiet' },
	];
	const pickd = await pick(items, { title: 'Selyh · Preferencias' });
	if (!pickd) {
		return;
	}
	let patch: Partial<Preferences>;
	if (pickd.key === 'focus') {
		patch = { focusMode: !p.focusMode };
	} else {
		const ask = (prompt: string, value: string) =>
			vscode.window.showInputBox({ title: 'Selyh · Horas de silencio', prompt, value, ignoreFocusOut: true, validateInput: (v) => (HHMM.test(v) ? null : 'Usa el formato HH:MM, por ejemplo 20:00.') });
		const mode = await pick([{ label: 'Elegir horario', on: true }, { label: 'Apagar', on: false }], { title: 'Selyh · Horas de silencio' });
		if (!mode) {
			return;
		}
		if (!mode.on) {
			patch = { quietHoursStart: null, quietHoursEnd: null };
		} else {
			const start = await ask('Desde (HH:MM)', p.quietHoursStart ?? '20:00');
			const end = start && (await ask('Hasta (HH:MM)', p.quietHoursEnd ?? '08:00'));
			if (!start || !end) {
				return;
			}
			patch = { quietHoursStart: start, quietHoursEnd: end };
		}
	}
	const saved = await ctx.api.call<Preferences>('PATCH', '/preferences', patch);
	if (ctx.store.state) {
		ctx.store.state.preferences.focusMode = saved.focusMode;
	}
	vscode.window.setStatusBarMessage(`$(check) Preferencias guardadas`, 4000);
}

// ───── Escalas, de a una pregunta ─────

interface ScaleMeta {
	code: string;
	minPerItem: number;
	maxPerItem: number;
	text: { period: string; items: string[]; options: string[] } | null;
}

export async function scaleBatch(ctx: Ctx) {
	const next = await ctx.api.call<{ scale: { code: string; total: number; answered: number; nextItems: number[] } | null }>('GET', '/prompts/next');
	const s = next.scale;
	if (!s) {
		void vscode.window.showInformationMessage(t.scaleNone);
		return;
	}
	await ctx.store.set('scaleShownDay', localDay());
	const catalog = await ctx.api.call<ScaleMeta[]>('GET', '/scales');
	const meta = catalog.find((c) => c.code === s.code);
	if (!meta?.text) {
		void vscode.window.showInformationMessage(t.scaleNone);
		return;
	}
	const name = scaleNames[s.code] ?? s.code;
	let answered = s.answered;
	for (const index of s.nextItems.slice(0, 3)) {
		const options = [];
		for (let v = meta.minPerItem; v <= meta.maxPerItem; v++) {
			options.push({ label: meta.text.options[v - meta.minPerItem] ?? String(v), value: v });
		}
		const a = await pick(options, { title: t.scaleItem(name, index + 1, s.total), placeHolder: meta.text.items[index] ?? '' });
		if (!a) {
			return;
		}
		const saved = await ctx.api.call<{ answered: number; crisis: { resources: CrisisResource[] } | null }>(
			'PUT',
			`/scales/${encodeURIComponent(s.code)}/progress?region=PE`,
			{ answers: [{ index, value: a.value }] },
		);
		answered = saved.answered;
		if (saved.crisis) {
			// Ayuda humana primero, sin esperar a terminar.
			await showCrisis(saved.crisis.resources);
			return;
		}
	}
	if (answered < s.total) {
		void vscode.window.showInformationMessage(t.scalePartDone);
		return;
	}
	const r = await ctx.api.call<{ totalScore: number; maxScore: number; band: string; note: string; crisis?: { resources: CrisisResource[] } | null }>(
		'POST',
		`/scales/${encodeURIComponent(s.code)}/progress/complete?region=PE`,
		{ source: 'ide' },
	);
	if (r.crisis?.resources?.length) {
		await showCrisis(r.crisis.resources);
	}
	await vscode.window.showInformationMessage(`${name}: ${Math.round(r.totalScore)} de ${Math.round(r.maxScore)} · ${r.band}`, {
		modal: true,
		detail: `${r.note}\n\n${t.scaleResultNote}`,
	});
}

// ───── Líneas de ayuda ─────

export async function showCrisis(resources?: CrisisResource[]) {
	const list = resources?.length ? resources.map((r) => `${r.name}: ${r.contactInfo}`) : [t.fallbackCrisis];
	const phone = resources?.map((r) => /\d{3,}/.exec(r.contactInfo)?.[0]).find(Boolean) ?? '113';
	const call = `Llamar al ${phone}`;
	const a = await vscode.window.showInformationMessage(t.crisisTitle, { modal: true, detail: `${list.join('\n')}\n\n${t.crisisDetail}` }, call);
	if (a === call) {
		await vscode.env.openExternal(vscode.Uri.parse(`tel:${phone}`));
	}
}
