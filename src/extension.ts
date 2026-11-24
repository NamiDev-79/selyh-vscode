import * as vscode from 'vscode';

import { BREAK_SECS, type DayActivity, emptyDay, localDay, metrics, record } from './activity';
import { Api, errorText } from './api';
import { webUrl, workHours } from './config';
import { scaleNames, t } from './copy';
import * as flows from './flows';
import { offerPause, openPause } from './pause';
import { opportunity } from './scheduler';
import { Store } from './store';

const TICK_MS = 20_000;
const SYNC_MS = 5 * 60_000;
const SAVE_MS = 60_000;
/** Entre pausas sugeridas sin pedirlas (como en la app de escritorio). */
const EXERCISE_GAP_MS = 120 * 60_000;

interface GitRepo {
	state: { HEAD?: { commit?: string }; onDidChange: vscode.Event<void> };
}
interface GitApi {
	repositories: GitRepo[];
	onDidOpenRepository: vscode.Event<GitRepo>;
}

export async function activate(context: vscode.ExtensionContext) {
	const api = new Api(context.secrets, context.globalState);
	const store = new Store(context.globalState, api, vscode.env.sessionId);
	const bar = vscode.window.createStatusBarItem('selyh.status', vscode.StatusBarAlignment.Right, 100);
	bar.name = 'Selyh';
	bar.command = 'selyh.menu';

	let linked = await api.linked();
	const ctx: flows.Ctx = { api, store, refresh: () => void paint(), openPause: () => openPause(ctx) };

	const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

	async function paint() {
		linked = await api.linked();
		const pausedUntil = store.get('pausedUntil', 0);
		const paused = pausedUntil > Date.now();
		const pending = store.pending();
		const name = store.get<string | null>('userName', null);
		bar.text = paused ? '$(debug-pause) Selyh' : pending ? `$(selyh-isotipo) Selyh · ${pending}` : '$(selyh-isotipo) Selyh';
		bar.tooltip = !linked
			? t.unlinked
			: [name ? `Selyh · ${name}` : 'Selyh', paused ? t.paused(hhmm(pausedUntil)) : 'Aparece solo en pausas naturales.', pending ? `${pending} check-in(s) esperando conexión.` : '']
					.filter(Boolean)
					.join('\n');
		bar.show();
	}

	/** Ejecuta un flujo: pide vincular si hace falta y muestra el error sin romper la extensión. */
	const run = (f: () => Promise<unknown>) => async () => {
		try {
			if (!(await api.linked())) {
				const a = await vscode.window.showInformationMessage(t.unlinked, t.link);
				if (a) {
					await flows.link(ctx);
				}
				return;
			}
			await f();
		} catch (e) {
			void vscode.window.showWarningMessage(errorText(e));
		} finally {
			void paint();
		}
	};

	// ───── Actividad del editor (solo con permiso) y pausas naturales (siempre, solo en memoria) ─────

	let day = localDay();
	let act: DayActivity = emptyDay();
	let lastEventAt = 0;
	let lastTypeAt = 0;
	let naturalPauseAt: number | undefined;
	let lastPeriodicAt = Date.now();
	let lastSync = 0;
	let lastSave = 0;

	const onActivity = (typing = false) => {
		if (!vscode.window.state.focused) {
			return;
		}
		const now = Date.now();
		if (lastEventAt && now - lastEventAt >= BREAK_SECS * 1000) {
			naturalPauseAt = now; // volviste de una pausa real
		}
		lastEventAt = now;
		if (typing) {
			lastTypeAt = now;
		}
		if (!store.granted('IDE_GIT')) {
			return;
		}
		const today = localDay();
		if (today !== day) {
			void store.saveActivity(day, act);
			day = today;
			act = emptyDay();
		}
		record(act, new Date(now), workHours());
		if (now - lastSave > SAVE_MS) {
			lastSave = now;
			void store.saveActivity(day, act);
		}
	};
	const naturalPause = () => (naturalPauseAt = Date.now());

	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((e) => e.document.uri.scheme === 'file' && onActivity(true)),
		vscode.window.onDidChangeTextEditorSelection(() => onActivity()),
		vscode.window.onDidChangeActiveTextEditor(() => onActivity()),
		vscode.window.onDidChangeWindowState((s) => s.focused && onActivity()),
		vscode.window.onDidOpenTerminal(() => onActivity()),
		vscode.debug.onDidTerminateDebugSession(naturalPause),
	);

	// Un commit (extensión de Git integrada) es una pausa natural.
	const git = vscode.extensions.getExtension<{ getAPI(v: 1): GitApi }>('vscode.git');
	if (git) {
		void Promise.resolve(git.isActive ? git.exports : git.activate()).then(
			(g) => {
				const gitApi = g.getAPI(1);
				const watch = (r: GitRepo) => {
					let head = r.state.HEAD?.commit;
					context.subscriptions.push(
						r.state.onDidChange(() => {
							const now = r.state.HEAD?.commit;
							if (now && head && now !== head) {
								naturalPause();
							}
							head = now;
						}),
					);
				};
				gitApi.repositories.forEach(watch);
				context.subscriptions.push(gitApi.onDidOpenRepository(watch));
			},
			() => undefined,
		);
	}

	// ───── Cada 20 s: ¿es buen momento? Solo la ventana con foco decide ─────

	/** Una sola cosa por vez: el check-in o, si ya respondiste, la tanda de escala del día. */
	const offer = async () => {
		const next = await api.call<{ quiet: boolean; checkIn: { due: boolean }; scale: { code: string } | null }>('GET', '/prompts/next');
		if (next.quiet) {
			return true; // horas de silencio: nada más
		}
		if (next.checkIn.due) {
			await flows.snooze(ctx); // aunque no responda, no se insiste por un rato
			const a = await vscode.window.showInformationMessage(t.nudge, t.answer, t.notNow);
			if (a === t.answer) {
				await run(() => flows.checkIn(ctx))();
			}
			return true;
		}
		if (next.scale && store.get('scaleShownDay', '') !== localDay()) {
			await store.set('scaleShownDay', localDay());
			const a = await vscode.window.showInformationMessage(t.scaleNudge(scaleNames[next.scale.code] ?? next.scale.code), t.answer, t.later);
			if (a === t.answer) {
				await run(() => flows.scaleBatch(ctx))();
			}
			return true;
		}
		return false;
	};

	let busy = false;
	const tick = async () => {
		if (busy || !linked || !vscode.window.state.focused) {
			return;
		}
		busy = true;
		try {
			const now = Date.now();
			if (now - lastSync > SYNC_MS) {
				lastSync = now;
				await store.saveActivity(day, act);
				await flows.sync(ctx).catch(() => undefined);
			}
			const kind = opportunity({
				now,
				focused: vscode.window.state.focused,
				lastTypeAt,
				naturalPauseAt,
				lastPeriodicAt,
				focusMode: store.state?.preferences.focusMode ?? false,
				cooldownUntil: store.get('cooldownUntil', 0),
				pausedUntil: store.get('pausedUntil', 0),
			});
			if (kind) {
				naturalPauseAt = undefined;
				lastPeriodicAt = now;
				const shown = await offer();
				// Nada pendiente y es una pausa natural: ¿hace falta una pausa breve? Decide el servidor.
				if (!shown && kind === 'pause' && now > store.get('exerciseAfter', 0)) {
					await store.set('exerciseAfter', now + EXERCISE_GAP_MS);
					await offerPause(ctx);
				}
			}
		} catch {
			/* sin red o sesión vencida: se reintenta en el próximo tick */
		} finally {
			busy = false;
		}
	};
	const timer = setInterval(() => void tick(), TICK_MS);

	// ───── Comandos ─────

	const menu = async () => {
		if (!(await api.linked())) {
			return run(async () => undefined)();
		}
		const paused = store.get('pausedUntil', 0) > Date.now();
		const items: (vscode.QuickPickItem & { cmd: string })[] = [
			{ label: '$(comment) Check-in', description: '¿Cómo vas?', cmd: 'selyh.checkIn' },
			{ label: '$(heart) Una pausa breve', description: 'Respiración o estiramiento guiado', cmd: 'selyh.pause' },
			{ label: '$(checklist) Responder escala', description: 'La tanda corta de hoy', cmd: 'selyh.scale' },
			{ label: '$(graph-line) Mi estado', description: 'Tu carga frente a tu propio ritmo', cmd: 'selyh.status' },
			{ label: '$(settings-gear) Modo foco y horas de silencio', cmd: 'selyh.preferences' },
			{ label: paused ? '$(play) Reanudar o cambiar la pausa de avisos' : '$(debug-pause) Pausar avisos', cmd: 'selyh.snooze' },
			{ label: '$(shield) Permisos', description: 'Qué compartes con Selyh', cmd: 'selyh.consent' },
			{ label: '$(eye) Qué se envía hoy', cmd: 'selyh.privacy' },
			{ label: '$(link-external) Abrir mi panel', description: 'En la web de Selyh', cmd: 'selyh.openPanel' },
			{ label: '$(call-outgoing) Líneas de ayuda', cmd: 'selyh.help' },
			{ label: '$(sign-out) Cerrar sesión', cmd: 'selyh.unlink' },
		];
		const p = await vscode.window.showQuickPick(items, { title: 'Selyh' });
		if (p) {
			await vscode.commands.executeCommand(p.cmd);
		}
	};

	const privacy = async () => {
		await store.saveActivity(day, act);
		const m = metrics(store.activityOf(localDay()));
		const detail = store.granted('IDE_GIT')
			? `Hoy, sumando todas tus ventanas:\n• Horas activas: ${m.hoursActive}\n• Minutos fuera de horario: ${m.afterHoursMinutes}\n• Racha continua más larga: ${m.longestStreakMinutes} min\n\nSolo estos tres números por día. Nunca código, archivos, teclas ni nombres de proyecto.`
			: 'Las señales del editor están apagadas: no se calcula ni se envía nada de tu actividad. Solo se envían los check-ins que respondes.';
		const a = await vscode.window.showInformationMessage('Lo que Selyh recibe de este editor', { modal: true, detail }, 'Cambiar permisos');
		if (a) {
			await flows.chooseConsent(ctx);
		}
	};

	context.subscriptions.push(
		bar,
		api.onSignedOut,
		api.onSignedOut.event(() => {
			void paint();
			void vscode.window.showInformationMessage(t.signedOut, t.link).then((a) => a && vscode.commands.executeCommand('selyh.link'));
		}),
		vscode.commands.registerCommand('selyh.menu', menu),
		vscode.commands.registerCommand('selyh.link', async () => {
			try {
				await flows.link(ctx);
			} catch (e) {
				void vscode.window.showWarningMessage(errorText(e));
			}
		}),
		vscode.commands.registerCommand('selyh.unlink', run(() => flows.unlink(ctx))),
		vscode.commands.registerCommand('selyh.checkIn', run(() => flows.checkIn(ctx))),
		vscode.commands.registerCommand('selyh.pause', run(() => openPause(ctx))),
		vscode.commands.registerCommand('selyh.scale', run(() => flows.scaleBatch(ctx))),
		vscode.commands.registerCommand('selyh.snooze', run(() => flows.pauseReminders(ctx))),
		vscode.commands.registerCommand('selyh.status', run(() => flows.status(ctx))),
		vscode.commands.registerCommand('selyh.preferences', run(() => flows.preferences(ctx))),
		vscode.commands.registerCommand('selyh.consent', run(() => flows.chooseConsent(ctx))),
		vscode.commands.registerCommand('selyh.privacy', run(privacy)),
		vscode.commands.registerCommand('selyh.help', () => flows.showCrisis()),
		vscode.commands.registerCommand('selyh.openPanel', () => vscode.env.openExternal(vscode.Uri.parse(`${webUrl()}/panel`))),
		context.secrets.onDidChange((e) => e.key === 'selyh.session' && void paint()),
		{
			dispose: () => {
				clearInterval(timer);
				void store.saveActivity(day, act);
			},
		},
	);

	await paint();
	if (linked) {
		void flows.sync(ctx).catch(() => undefined);
	} else if (!store.get('welcomed', false)) {
		await store.set('welcomed', true);
		// Sin await: la activación no espera a que la persona responda el aviso.
		void vscode.window.showInformationMessage(`Selyh: ${t.unlinked}`, t.link).then((a) => a && vscode.commands.executeCommand('selyh.link'));
	}
}

export function deactivate() {}
