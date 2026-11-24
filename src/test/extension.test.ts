import * as assert from 'assert';
import * as vscode from 'vscode';

import { emptyDay, isAfterHours, localDay, merge, metrics, record, type WorkHours } from '../activity';
import { t } from '../copy';
import { renderMarkdown } from '../pause';
import { LULL_MS, type Moment, opportunity, PERIODIC_MS, WINDOW_MS } from '../scheduler';

const wh: WorkHours = { start: '09:00', end: '18:00', weekends: false };
// Lunes 2026-11-23 (hora local)
const at = (h: number, m = 0, s = 0) => new Date(2026, 10, 23, h, m, s);

suite('Actividad del editor', () => {
	test('cuenta el tiempo entre eventos cercanos y corta la racha tras una pausa real', () => {
		const d = emptyDay();
		assert.strictEqual(record(d, at(10, 0), wh), false);
		record(d, at(10, 1), wh); // +60 s
		record(d, at(10, 2), wh); // +60 s
		assert.strictEqual(d.activeSecs, 120);
		assert.strictEqual(d.longestStreakSecs, 120);
		// 10 min sin eventos: no suma y avisa que fue una pausa real
		assert.strictEqual(record(d, at(10, 12), wh), true);
		assert.strictEqual(d.activeSecs, 120);
		record(d, at(10, 13), wh);
		assert.strictEqual(d.streakSecs, 60);
		assert.strictEqual(d.longestStreakSecs, 120);
	});

	test('fuera de horario: noche, fin de semana y horarios que cruzan la medianoche', () => {
		assert.strictEqual(isAfterHours(at(10), wh), false);
		assert.strictEqual(isAfterHours(at(19), wh), true);
		assert.strictEqual(isAfterHours(new Date(2026, 10, 22, 11), wh), true); // domingo
		assert.strictEqual(isAfterHours(new Date(2026, 10, 22, 11), { ...wh, weekends: true }), false);
		const night = { start: '22:00', end: '06:00', weekends: true };
		assert.strictEqual(isAfterHours(at(23), night), false);
		assert.strictEqual(isAfterHours(at(12), night), true);
	});

	test('suma ventanas y envía solo tres números', () => {
		const a = { ...emptyDay(), activeSecs: 3600, afterHoursSecs: 600, longestStreakSecs: 1200 };
		const b = { ...emptyDay(), activeSecs: 1800, afterHoursSecs: 0, longestStreakSecs: 1500 };
		assert.deepStrictEqual(metrics(merge([a, b])), { hoursActive: 1.5, afterHoursMinutes: 10, longestStreakMinutes: 25 });
		assert.strictEqual(localDay(at(0, 5)), '2026-11-23');
	});
});

suite('Cuándo preguntar', () => {
	const base: Moment = { now: 10_000_000, focused: true, lastTypeAt: 0, lastPeriodicAt: 10_000_000, focusMode: false, cooldownUntil: 0, pausedUntil: 0 };

	test('tras una pausa natural, si no estás escribiendo', () => {
		assert.strictEqual(opportunity({ ...base, naturalPauseAt: base.now - 1000 }), 'pause');
		assert.strictEqual(opportunity({ ...base, naturalPauseAt: base.now - 1000, lastTypeAt: base.now - LULL_MS + 1 }), null);
		assert.strictEqual(opportunity({ ...base, naturalPauseAt: base.now - WINDOW_MS - 1 }), null);
	});

	test('nunca sin foco, en pausa ni en enfriamiento; lo periódico respeta el modo foco', () => {
		const p = { ...base, naturalPauseAt: base.now };
		assert.strictEqual(opportunity({ ...p, focused: false }), null);
		assert.strictEqual(opportunity({ ...p, pausedUntil: base.now + 1 }), null);
		assert.strictEqual(opportunity({ ...p, cooldownUntil: base.now + 1 }), null);
		const late = { ...base, lastPeriodicAt: base.now - PERIODIC_MS };
		assert.strictEqual(opportunity(late), 'periodic');
		assert.strictEqual(opportunity({ ...late, focusMode: true }), null);
	});
});

suite('Contenido', () => {
	test('el Markdown de las pausas escapa HTML', () => {
		const html = renderMarkdown('# Respira\n1. **Inhala** 4 s\n2. Exhala\n<script>alert(1)</script>');
		assert.ok(html.includes('<h3>Respira</h3>'));
		assert.ok(html.includes('<ol>') && html.includes('<strong>Inhala</strong>'));
		assert.ok(!html.includes('<script>'));
	});

	test('textos sin palabras que el manual de marca evita', () => {
		const all = JSON.stringify(t, (_k, v) => (typeof v === 'function' ? v('X', 1, 2) : v)).toLowerCase();
		for (const w of ['paciente', 'trastorno', 'monitoreo', 'vigilancia']) {
			assert.ok(!all.includes(w), w);
		}
	});

	test('la extensión registra sus comandos', async () => {
		await vscode.extensions.getExtension('selyh.selyh')?.activate();
		const cmds = await vscode.commands.getCommands(true);
		for (const c of ['selyh.menu', 'selyh.link', 'selyh.checkIn', 'selyh.pause', 'selyh.scale', 'selyh.status', 'selyh.preferences']) {
			assert.ok(cmds.includes(c), c);
		}
	});
});
