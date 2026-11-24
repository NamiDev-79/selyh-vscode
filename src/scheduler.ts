/**
 * Cuándo ofrecer algo. Solo en pausas naturales (commit, fin de una depuración, volver tras 5 min
 * sin actividad) y, fuera del modo foco, de vez en cuando. Nunca mientras escribes ni en una
 * ventana sin foco. El servidor (`GET /prompts/next`) tiene la última palabra: horas de silencio,
 * si ya respondiste hoy y si toca una escala. Lógica pura, sin `vscode`.
 */

/** Segundos sin teclear antes de mostrar algo: nunca a mitad de una línea. */
export const LULL_MS = 4_000;
/** Tras una pausa natural, la oportunidad dura esto. */
export const WINDOW_MS = 3 * 60_000;
/** Fuera del modo foco, cada cuánto se reconsidera aunque no haya pausa. */
export const PERIODIC_MS = 45 * 60_000;

export interface Moment {
	now: number;
	focused: boolean;
	lastTypeAt: number;
	naturalPauseAt?: number;
	lastPeriodicAt: number;
	focusMode: boolean;
	cooldownUntil: number;
	pausedUntil: number;
}

export function opportunity(m: Moment): 'pause' | 'periodic' | null {
	if (!m.focused || m.now < m.pausedUntil || m.now < m.cooldownUntil || m.now - m.lastTypeAt < LULL_MS) {
		return null;
	}
	if (m.naturalPauseAt !== undefined && m.now - m.naturalPauseAt <= WINDOW_MS) {
		return 'pause';
	}
	if (!m.focusMode && m.now - m.lastPeriodicAt >= PERIODIC_MS) {
		return 'periodic';
	}
	return null;
}
