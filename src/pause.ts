import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

import { errorText } from './api';
import { t } from './copy';
import { type Ctx, showCrisis } from './flows';

interface Intervention {
	id: string;
	title: string;
	bodyMarkdown: string;
	durationMinutes: number;
	category: string;
}
interface Next {
	suggestion: { id: string; intervention: Intervention } | null;
	reason: string;
	resources?: { name: string; contactInfo: string }[];
}

let panel: vscode.WebviewPanel | undefined;

/** Pide una pausa al servidor (respeta el tope diario y las alertas abiertas) y la abre en un panel. */
export async function openPause(ctx: Ctx) {
	try {
		const next = await ctx.api.call<Next>('POST', '/interventions/suggestions/next?region=PE&manual=true');
		let s = next.suggestion;
		if (next.reason === 'OPEN_CRISIS_FLAG') {
			return showCrisis(next.resources);
		}
		if (!s && next.reason === 'PENDING_SUGGESTION') {
			s = await pending(ctx);
		}
		if (!s) {
			void vscode.window.showInformationMessage(t.noneAvailable[next.reason] ?? t.noneAvailable.NO_CONTENT_AVAILABLE);
			return;
		}
		await ctx.api.call('POST', `/interventions/suggestions/${s.id}/respond`, { response: 'ACCEPTED' });
		show(ctx, s.id, s.intervention);
	} catch (e) {
		void vscode.window.showWarningMessage(errorText(e));
	}
}

/**
 * Sin pedirla: en una pausa natural, el servidor decide si hace falta (tendencia en aumento,
 * tope diario, horas de silencio). Se OFRECE con un aviso; nunca se abre sola.
 */
export async function offerPause(ctx: Ctx) {
	const next = await ctx.api.call<Next>('POST', '/interventions/suggestions/next?region=PE');
	const s = next.suggestion;
	if (!s) {
		return false;
	}
	const respond = (response: 'ACCEPTED' | 'POSTPONED') => ctx.api.call('POST', `/interventions/suggestions/${s.id}/respond`, { response });
	void vscode.window.showInformationMessage(t.pauseOffer(s.intervention.title, Math.max(1, Math.round(s.intervention.durationMinutes))), t.pauseStart, t.notNow).then(async (a) => {
		try {
			if (a === t.pauseStart) {
				await respond('ACCEPTED');
				show(ctx, s.id, s.intervention);
			} else {
				await respond('POSTPONED');
			}
		} catch (e) {
			void vscode.window.showWarningMessage(errorText(e));
		}
	});
	return true;
}

/** La pausa sugerida antes y aún sin responder. */
async function pending(ctx: Ctx) {
	const rows = await ctx.api.call<{ id: string; interventionId: string; respondedAt: string | null }[]>('GET', '/interventions/suggestions');
	const open = rows.find((r) => r.respondedAt === null);
	if (!open) {
		return null;
	}
	const lib = await ctx.api.call<Intervention[]>('GET', '/interventions');
	const i = lib.find((x) => x.id === open.interventionId);
	return i ? { id: open.id, intervention: i } : null;
}

function show(ctx: Ctx, suggestionId: string, i: Intervention) {
	panel?.dispose();
	panel = vscode.window.createWebviewPanel('selyh.pause', `Selyh · ${i.title}`, vscode.ViewColumn.Active, { enableScripts: true });
	panel.onDidDispose(() => (panel = undefined));
	panel.webview.html = html(i);
	panel.webview.onDidReceiveMessage(async (m: { feedback?: 'HELPFUL' | 'NOT_HELPFUL'; close?: boolean }) => {
		if (m.feedback === 'HELPFUL' || m.feedback === 'NOT_HELPFUL') {
			await ctx.api.call('POST', `/interventions/suggestions/${suggestionId}/feedback`, { feedback: m.feedback }).catch(() => undefined);
		}
		if (m.close) {
			panel?.dispose();
		}
	});
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Markdown mínimo del contenido clínico: títulos, listas, negrita y cursiva. Todo se escapa antes. */
export function renderMarkdown(md: string): string {
	const inline = (s: string) =>
		esc(s)
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.+?)\*/g, '<em>$1</em>');
	const out: string[] = [];
	let list: 'ul' | 'ol' | null = null;
	const close = () => {
		if (list) {
			out.push(`</${list}>`);
			list = null;
		}
	};
	for (const raw of md.split(/\r?\n/)) {
		const line = raw.trim();
		const h = /^(#{1,3})\s+(.*)$/.exec(line);
		const ol = /^\d+[.)]\s+(.*)$/.exec(line);
		const ul = /^[-*]\s+(.*)$/.exec(line);
		if (h) {
			close();
			out.push(`<h3>${inline(h[2])}</h3>`);
		} else if (ol || ul) {
			const kind = ol ? 'ol' : 'ul';
			if (list !== kind) {
				close();
				out.push(`<${kind}>`);
				list = kind;
			}
			out.push(`<li>${inline((ol ?? ul)![1])}</li>`);
		} else if (line) {
			close();
			out.push(`<p>${inline(line)}</p>`);
		} else {
			close();
		}
	}
	close();
	return out.join('\n');
}

function html(i: Intervention) {
	const nonce = randomBytes(16).toString('base64');
	const breathing = i.category === 'BREATHING';
	return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
  :root { --brand: #6363F1; --soft: #A2A2FA; --tint: color-mix(in srgb, #6363F1 12%, transparent); }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); line-height: 1.6; padding: 26px; max-width: 620px; margin: 0 auto; }
  .bars { display: flex; gap: 10px; align-items: flex-end; height: 110px; justify-content: center; margin: 10px 0 6px; }
  .bars span { width: 26px; border-radius: 99px; }
  .tall { height: 100px; background: var(--brand); }
  .short { height: 62px; background: var(--soft); transform-origin: bottom; }
  .breathe .short { animation: box 16s cubic-bezier(.3,0,.25,1) infinite; }
  @keyframes box { 0% { transform: scaleY(1); } 25% { transform: scaleY(1.618); } 50% { transform: scaleY(1.618); } 75% { transform: scaleY(1); } 100% { transform: scaleY(1); } }
  .gap { height: 16px; } .ask { align-self: center; }
  .phase { text-align: center; color: var(--vscode-descriptionForeground); min-height: 1.6em; margin-bottom: 16px; }
  .meta { color: var(--vscode-descriptionForeground); font-size: .9em; }
  h1 { font-size: 1.5em; margin: 0 0 4px; } h3 { margin: 1.2em 0 .3em; }
  .card { background: var(--tint); border-radius: 16px; padding: 16px 20px; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 26px; }
  button { font: inherit; border-radius: 99px; padding: 8px 18px; border: 1px solid var(--brand); background: transparent; color: var(--vscode-foreground); cursor: pointer; }
  button.primary { background: var(--brand); color: #fff; }
  button:focus-visible { outline: 2px solid var(--soft); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .breathe .short { animation: none; } }
</style></head>
<body>
  <h1>${esc(i.title)}</h1>
  <div class="meta">${Math.max(1, Math.round(i.durationMinutes))} min</div>
  ${breathing ? `<div class="bars breathe" aria-hidden="true"><span class="tall"></span><span class="short"></span></div><div class="phase" id="phase" role="status" aria-live="polite"></div>` : '<div class="gap"></div>'}
  <div class="card">${renderMarkdown(i.bodyMarkdown)}</div>
  <div class="actions" id="actions">
    <span class="meta ask">¿Te sirvió?</span>
    <button class="primary" data-f="HELPFUL">Sí, me sirvió</button>
    <button data-f="NOT_HELPFUL">No mucho</button>
    <button data-close="1">Cerrar</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.f) {
        vscode.postMessage({ feedback: b.dataset.f, close: true });
      } else {
        vscode.postMessage({ close: true });
      }
    }));
    const phase = document.getElementById('phase');
    if (phase) {
      const steps = ['Inhala…', 'Sostén…', 'Exhala…', 'Sostén…'];
      let k = 0;
      const tick = () => { phase.textContent = steps[k % 4]; k++; };
      tick();
      setInterval(tick, 4000);
    }
  </script>
</body></html>`;
}
